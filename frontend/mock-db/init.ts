import { createPerson, getPersonByEmail, type Person } from 'wildebeest/backend/src/activitypub/actors'
import * as statusesAPI from 'wildebeest/functions/api/v1/statuses'
import * as reblogAPI from 'wildebeest/functions/api/v1/statuses/[id]/reblog'
import { replies, statuses } from 'wildebeest/frontend/src/dummyData'
import type { Account, MastodonStatus } from 'wildebeest/frontend/src/types'

const kek = 'test-kek'
/* eslint-disable @typescript-eslint/no-empty-function */
const queue = {
	async send() {},
	async sendBatch() {},
}
const kv_cache = {
	async put() {},
}
/* eslint-enable @typescript-eslint/no-empty-function */

/**
 * Run helper commands to initialize the database with actors, statuses, etc.
 */
export async function init(domain: string, db: D1Database) {
	const loadedStatuses: MastodonStatus[] = []
	const targetMastodonIdsMap = new Map<null | string, string | undefined>([[null, undefined]])
	replies.forEach((reply) => {
		if (!reply.in_reply_to_id) {
			// eslint-disable-next-line no-console
			console.warn(`Ignoring reply with id ${reply.id} since it doesn't have a in_reply_to_id field`)
		} else {
			targetMastodonIdsMap.set(reply.in_reply_to_id, undefined)
		}
	})
	for (const status of [...statuses, ...replies]) {
		const actor = await getOrCreatePerson(domain, db, status.account)

		const createdStatus = await createStatus(db, actor, status.content, targetMastodonIdsMap.get(status.in_reply_to_id))
		loadedStatuses.push(createdStatus)
		if (targetMastodonIdsMap.has(status.id)) {
			targetMastodonIdsMap.set(status.id, createdStatus.mastodonId)
		}
	}

	// Grab the account from an arbitrary status to use as the reblogger
	const rebloggerAccount = loadedStatuses[1].account
	const reblogger = await getOrCreatePerson(domain, db, rebloggerAccount)
	// Reblog an arbitrary status with this reblogger
	const statusToReblog = loadedStatuses[2]
	await reblogStatus(db, reblogger, statusToReblog)
}

/**
 * Create a status object in the given actors outbox.
 */
async function createStatus(
	db: D1Database,
	actor: Person,
	status: string,
	inReplyToId?: string,
	visibility = 'public'
) {
	const body = {
		status,
		visibility,
		...(inReplyToId ? { in_reply_to_id: inReplyToId } : {}),
	}
	const headers = {
		'content-type': 'application/json',
	}
	const req = new Request('https://example.com', {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
	})
	const resp = await statusesAPI.handleRequest(req, db, actor, kek, queue, kv_cache as unknown as KVNamespace)
	return (await resp.json()) as MastodonStatus & { mastodonId: string }
}

async function getOrCreatePerson(
	domain: string,
	db: D1Database,
	{ username, avatar, display_name }: Account
): Promise<Person> {
	const person = await getPersonByEmail(db, username)
	if (person) return person
	const newPerson = await createPerson(domain, db, kek, username, {
		icon: { url: avatar },
		name: display_name,
	})
	if (!newPerson) {
		throw new Error('Could not create Actor ' + username)
	}
	return newPerson
}

async function reblogStatus(db: D1Database, actor: Person, status: MastodonStatus) {
	await reblogAPI.handleRequest(db, status.id, actor, kek, queue)
}
