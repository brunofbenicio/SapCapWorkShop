// Maps the priorityScore of a customer message (0..5, see db/schema.cds) to a
// priority level that agents can act on.
const LEVELS = [
	{ minScore: 5, level: 'Critical' },
	{ minScore: 4, level: 'High' },
	{ minScore: 2, level: 'Medium' },
	{ minScore: 0, level: 'Low' }
];

/**
 * @param {number} score priorityScore of a customer message
 * @returns {'Critical'|'High'|'Medium'|'Low'}
 */
function priorityLevel(score) {
	const value = Number(score) || 0;
	return LEVELS.find(({ minScore }) => value >= minScore).level;
}

module.exports = { priorityLevel };
