process.env.TS_NODE_PROJECT = 'tsconfig.test.json';
require('ts-node').register({ project: 'tsconfig.test.json' });

module.exports = {
    extension: ['ts'],
    exit: true,
};
