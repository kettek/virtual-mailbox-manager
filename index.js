const { program } = require('commander')
const fs = require('fs')
const web = require('./web')
const mysql = require('./mysql')

async function run() {
	let ctx = {}

	let config = {
		mysql: {},
		web: {},
	}

	try {
		config = JSON.parse(fs.readFileSync('conf.json', 'utf8'))
	} catch(e) {
		throw e
	}

	await mysql(ctx, config.mysql)
	await web(ctx, config.web)
}

async function main() {
	program
		.command('run')
		.action(run)
	await program.parseAsync(process.argv)
}

main()

