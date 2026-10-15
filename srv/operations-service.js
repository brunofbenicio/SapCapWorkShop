const cds = require('@sap/cds');
const { priorityLevel } = require('./code/priority');
const { subscribe } = require('./code/message-events');

// Group label for messages that the AI has not classified yet
const UNCLASSIFIED = 'Unclassified';

module.exports = class OperationsService extends cds.ApplicationService {
	async init() {
		const { CustomerMessages } = this.entities;

		// The handler functions must not be named like the actions: cds would treat such methods
		// as shortcuts to call the action.
		this.on('markAsResolved', CustomerMessages, req => this.resolveMessage(req));
		this.on('addReply', CustomerMessages, req => this.createReply(req));
		this.on('suggestedPriority', CustomerMessages, req => this.suggestPriority(req));
		this.on('statistics', () => this.countMessages());

		// Without a messaging service the events are only delivered to handlers of this service.
		if (cds.requires.messaging) subscribe(await cds.connect.to('messaging'), this.name);

		return super.init();
	}

	async resolveMessage(req) {
		const { SELECT, UPDATE } = cds.ql;
		const message = await this.run(SELECT.one.from(req.subject).columns('ID', 'customerMessageID', 'status'));
		if (!message) return req.reject(404, 'The customer message does not exist');
		if (message.status === 'Resolved') return req.reject(409, 'The customer message is already resolved');

		// The status fields are read-only for clients, so they are written on the database directly.
		const { CustomerMessages } = cds.entities('Benicio_1_04');
		const resolved = {
			status: 'Resolved',
			resolvedAt: new Date().toISOString(),
			resolvedBy: req.user.id,
			resolution: req.data.resolution ?? null
		};
		await cds.db.run(UPDATE(CustomerMessages).set(resolved).where({ ID: message.ID }));

		await this.emit('MessageResolved', {
			messageID: message.ID,
			customerMessageID: message.customerMessageID,
			resolvedBy: resolved.resolvedBy,
			resolvedAt: resolved.resolvedAt,
			resolution: resolved.resolution
		});

		return this.run(SELECT.one.from(req.subject));
	}

	async createReply(req) {
		const { SELECT, INSERT } = cds.ql;
		const message = await this.run(SELECT.one.from(req.subject).columns('ID', 'customerMessageID'));
		if (!message) return req.reject(404, 'The customer message does not exist');

		const { CustomerMessageReplies } = cds.entities('Benicio_1_04');
		const { author, text } = req.data;
		const ID = cds.utils.uuid();
		await cds.db.run(INSERT.into(CustomerMessageReplies).entries({ ID, message_ID: message.ID, author, text }));
		const reply = await this.run(SELECT.one.from(this.entities.CustomerMessageReplies).where({ ID }));

		await this.emit('ReplyAdded', {
			messageID: message.ID,
			customerMessageID: message.customerMessageID,
			replyID: reply.ID,
			author: reply.author,
			sentAt: reply.sentAt
		});

		return reply;
	}

	async suggestPriority(req) {
		const { SELECT } = cds.ql;
		const message = await this.run(SELECT.one.from(req.subject).columns('priorityScore'));
		if (!message) return req.reject(404, 'The customer message does not exist');
		return { score: message.priorityScore, level: priorityLevel(message.priorityScore) };
	}

	async countMessages() {
		const { SELECT } = cds.ql;
		const { CustomerMessages } = this.entities;
		const countBy = async column => {
			const rows = await this.run(SELECT.from(CustomerMessages)
				.columns(`${column} as value`, 'count(*) as count')
				.groupBy(column));
			return rows
				.map(({ value, count }) => ({ value: value ?? UNCLASSIFIED, count }))
				.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
		};

		const [byStatus, byCategory, byUrgency] = await Promise.all([
			countBy('status'), countBy('messageCategory'), countBy('messageUrgency')
		]);
		const countOf = status => byStatus.find(({ value }) => value === status)?.count ?? 0;

		return {
			total: byStatus.reduce((sum, { count }) => sum + count, 0),
			open: countOf('Open'),
			resolved: countOf('Resolved'),
			byCategory,
			byUrgency
		};
	}
};
