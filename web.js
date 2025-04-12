const express = require('express')
const session = require('express-session')
const bodyParser = require('body-parser')
const crypto = require('crypto')

async function checkCredentials(ctx, u, p) {
	p = await makePassword(p)
	let r = await ctx.mysql.query('SELECT password FROM virtual_users WHERE email=?', [u])
	// Why does the SQL password have a random newline?
	if (r.length !== 0 && r[0].password.replace(/\n/g, '') === p) {
		return true
	} else {
		throw 'incorrect username or password'
	}
}

function makePassword(p) {
	return new Promise((resolve, reject) => {
		let h = crypto.createHash('sha512')
		h.on('readable', _ => {
			const d = h.read()
			if (d === null) {
				reject()
				return
			}
			resolve(d.toString('base64'))
		})
		h.write(p)
		h.end()
	})
}

async function isAdmin(ctx, u) {
	let r = await ctx.mysql.query('SELECT * FROM admins WHERE email=?', [u])
	if (r.length > 0) return true
	return false
}

async function run(ctx, {port=80,secret='vmm'}={}) {
	const e = express()
	e.use(session({
		secret: secret,
		resave: true,
		saveUninitialized: true,
	}))
	e.use(bodyParser.urlencoded({extended: true}))
	e.use(bodyParser.json())
	e.set('view engine', 'pug')

	e.get('/manage/', async (req, res) => {
		if (req.session.loggedIn) {
			let o = {}
			o.username = req.session.username
			o.admin = await isAdmin(ctx, o.username)
			o.aliases = await ctx.mysql.query('SELECT * FROM virtual_aliases WHERE owner=?', [o.username])
			o.domains = await ctx.mysql.query('SELECT * FROM virtual_domains')
			if (o.admin) {
				o.users = await ctx.mysql.query('SELECT * FROM virtual_users')
			}
			res.render('manage', o)
		} else {
			res.render('login')
		}
	})
	e.post('/manage/', async (req, res) => {
		let o = {}
		// First handle if we're already logged in.
		if (req.session.loggedIn) {
			try {
				// Early bail if we're logging out.
				if (req.body.action === 'logout') {
					delete req.session.loggedIn
					delete req.session.username
					return res.redirect('/manage/')
				}
				// Get relevant data from the database.
				o.username = req.session.username
				o.admin = await isAdmin(ctx, o.username)
				o.aliases = await ctx.mysql.query('SELECT * FROM virtual_aliases WHERE owner=?', [req.session.username])
				o.domains = await ctx.mysql.query('SELECT * FROM virtual_domains')
				if (o.admin) {
					o.users = await ctx.mysql.query('SELECT * FROM virtual_users')
				}
				// Handle our actions.
				if (req.body.action === 'changePassword') {
					let { password, newPassword, newPassword2 } = req.body
					if (!password) {
						o.error = 'old password must not be empty'
					} else if (newPassword === '' || newPassword2 === '') {
						o.error = 'new passwords must not be empty'
					} else if (newPassword !== newPassword2) {
						o.error = 'new passwords must match'
					} else {
						await checkCredentials(ctx, req.session.username, password)
						let hash = await makePassword(newPassword)
						let r = await ctx.mysql.query('UPDATE virtual_users SET password=? WHERE email=?', [hash, req.session.username])
						o.message = 'changed password'
					}
				} else if (req.body.action === 'changeDomain') {
					if (!o.admin) throw `wat u tryin to do`
					let { id, new_id, name } = req.body
					id = Number(id)
					let d = o.domains.find(v=>v.id===id)
					let r = await ctx.mysql.query('UPDATE virtual_domains SET id=?, name=? WHERE id=?', [new_id, name, id])
					o.message = `changed domain ${id}:${d?d.name:''} to ${new_id}:${name}`
				} else if (req.body.action === 'removeDomain') {
					if (!o.admin) throw `wat u tryin to do`
					let id = req.body.id
					id = Number(id)
					let d = o.domains.find(v=>v.id===id)
					let r = await ctx.mysql.query('DELETE FROM virtual_domains WHERE id=?', [id])
					o.message = `removed domain ${d?d.name:''}`
				} else if (req.body.action === 'addDomain') {
					if (!o.admin) throw `wat u tryin to do`
					let { name } = req.body
					let r = await ctx.mysql.query("INSERT INTO virtual_domains (name) VALUES (?)", [name])
					o.message = `added domain ${name}`
				} else if (req.body.action === 'addUser') {
					if (!o.admin) throw `wat u tryin to do`
					let { email, domain_id, password, password2 } = req.body
					if (!password || !password2) {
						throw 'passwords must not be empty'
					} else if (!password !== !password2) {
						throw 'passwords must match'
					}
					let hash = await makePassword(password)
					domain_id = Number(domain_id)
					let r = await ctx.mysql.query('INSERT INTO virtual_users (domain_id, password, email) VALUES (?, ?, ?)', [domain_id, hash, email])
					o.message = `added user ${email} into domain ${domain_id}`
				} else if (req.body.action === 'removeUser') {
					if (!o.admin) throw `wat u tryin to do`
					let id = Number(req.body.id)
					let r = await ctx.mysql.query('DELETE FROM virtual_users WHERE id=?', [id])
					o.message = ``
				} else if (req.body.action === 'changeUser') {
					if (!o.admin) throw `wat u tryin to do`
					let { id, new_id, domain_id, email, password, password2 } = req.body
					let u = o.users.find(v=>v.id===Number(id))
					if (password) {
						if (!password || !password2) {
							throw 'passwords must not be empty'
						} else if (!password !== !password2) {
							throw 'passwords must match'
						}
						let hash = await makePassword(password)
						let r = await ctx.mysql.query('UPDATE virtual_users SET id=?, domain_id=?, email=?, password=? WHERE id=?', [new_id, domain_id, email, hash, id])
					} else {
						let r = await ctx.mysql.query('UPDATE virtual_users SET id=?, domain_id=?, email=? WHERE id=?', [new_id, domain_id, email, id])
					}
					o.message = `changed user ${u.id}:${u.email}`
				} else if (req.body.action === 'changeAlias') {
					let { id, source, destination } = req.body
					if (!source || !destination) {
						o.error = 'alias source and destination is required'
					} else if (!o.aliases.find(v=>v.id === Number(id))) {
						o.error = 'target id does not exist in owned aliases'
					} else {
						let r = await ctx.mysql.query('UPDATE virtual_aliases SET source=?, destination=? WHERE id=?', [source, destination, id])
					}
				} else if (req.body.action === 'removeAlias') {
					let { id } = req.body
					id = Number(id)
					if (!o.aliases.find(v=>v.id === id)) {
						o.error = 'target id does not exist in owned aliases'
					} else {
						let r = await ctx.mysql.query('DELETE FROM virtual_aliases WHERE id=?', [id])
						o.message = 'removed alias'
					}
				} else if (req.body.action === 'addAlias') {
					let r = await ctx.mysql.query('SELECT domain_id FROM virtual_users WHERE email=?', [req.session.username])
					if (r.length === 0) {
						o.error = 'no associated domain_id for user'
					} else {
						let { domain_id } = r[0]
						let { source, destination } = req.body
						if (!source || !destination) {
							o.error = 'alias source and destination is required'
						} else {
							let r = await ctx.mysql.query("INSERT INTO virtual_aliases (domain_id, owner, source, destination) VALUES (?, ?, ?, ?)", [domain_id, req.session.username, source, destination])
							o.message = 'successfully added alias'
						}
					}
				}
				// Feeling lazy, so let's just reacquire the aliases 24/7. We should either just do a redirect or use an "aliases changed" variable to conditionally trigger the next line.
				o.aliases = await ctx.mysql.query('SELECT * FROM virtual_aliases WHERE owner=?', [req.session.username])
				if (o.admin) {
					o.domains = await ctx.mysql.query('SELECT * FROM virtual_domains')
					o.users = await ctx.mysql.query('SELECT * FROM virtual_users')
				}
			} catch(err) {
				o.error = err
			}
			return res.render('manage', o)
		}

		// Otherwise attempt to handle as a login.
		try {
			let { username, password } = req.body
			if (username && password) {
				await checkCredentials(ctx, username, password)
				req.session.loggedIn = true
				req.session.username = username
				res.redirect('/manage/')
			} else {
				throw 'please enter a username and password'
			}
		} catch(err) {
			res.render('login', {error: err})
		}
	})

	e.listen(port)
	ctx.express = e
	console.log(`Now running on port ${port}`)
}

module.exports = run
