const { priorityLevel } = require('../srv/code/priority');

describe('priorityLevel', () => {
    it.each([
        [0, 'Low'],
        [1, 'Low'],
        [2, 'Medium'],
        [3, 'Medium'],
        [4, 'High'],
        [5, 'Critical']
    ])('maps the score %i to %s', (score, level) => {
        expect(priorityLevel(score)).toBe(level);
    });

    it('treats a missing or invalid score as 0', () => {
        expect(priorityLevel(undefined)).toBe('Low');
        expect(priorityLevel(null)).toBe('Low');
        expect(priorityLevel('abc')).toBe('Low');
    });

    it('caps scores above the maximum at Critical', () => {
        expect(priorityLevel(9)).toBe('Critical');
    });
});
