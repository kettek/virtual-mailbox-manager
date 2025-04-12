const mysql = require('promise-mysql')

async function run(ctx, {host='localhost',user='',password='',database=''}={}) {
	ctx.mysql = {
		connection: null,
		query: (...args) => {
			return ctx.mysql.connection.query(...args)
		},
		connect: async () => {
			ctx.mysql.connection = await mysql.createConnection({
				host: host,
				user: user,
				password: password,
				database: database,
			})
			ctx.mysql.connection.on('error', ctx.mysql.onError)
		},
		onError: async e => {
			console.error(e)
			if (e === 'PROTOCOL_CONNECTION_LOST' || e === 'ECONNRESET') {
				ctx.mysql.connection.off('error', ctx.mysql.onError)
				await ctx.mysql.connect()
			}
		}
	}
	await ctx.mysql.connect()
}

module.exports = run
