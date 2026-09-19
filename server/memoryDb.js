// In-memory replacement for the MongoDB driver (USE_MEMORY_DB=1, used for local development and the tests).
// Implements only what store.js and the OTP modules use.
const clone = (v) => structuredClone(v);

function matchesQuery(doc, query) {
    return Object.entries(query || {}).every(([k, v]) => doc[k] === v);
}

class MemoryCollection {
    constructor(name) {
        this.name = name;
        this.docs = [];
        this.uniqueFields = [];
    }

    async createIndex(spec, options = {}) {
        if (options.unique) this.uniqueFields.push(...Object.keys(spec));
    }

    find(query = {}) {
        const rows = this.docs.filter((d) => matchesQuery(d, query)).map(clone);
        return { toArray: async () => rows };
    }

    async findOne(query = {}) {
        const doc = this.docs.find((d) => matchesQuery(d, query));
        return doc ? clone(doc) : null;
    }

    async insertOne(doc) {
        for (const field of this.uniqueFields) {
            if (doc[field] === undefined) continue; // sparse
            if (this.docs.some((d) => d[field] === doc[field])) {
                const err = new Error(`E11000 duplicate key on ${field}`);
                err.code = 11000;
                throw err;
            }
        }
        this.docs.push(clone(doc));
        return { acknowledged: true, insertedId: doc._id };
    }

    async replaceOne(query, doc, options = {}) {
        const i = this.docs.findIndex((d) => matchesQuery(d, query));
        if (i === -1) {
            if (options.upsert) this.docs.push(clone(doc));
            return { matchedCount: 0, upsertedCount: options.upsert ? 1 : 0 };
        }
        this.docs[i] = clone(doc);
        return { matchedCount: 1 };
    }

    async deleteOne(query) {
        const i = this.docs.findIndex((d) => matchesQuery(d, query));
        if (i === -1) return { deletedCount: 0 };
        this.docs.splice(i, 1);
        return { deletedCount: 1 };
    }
}

export function createMemoryDb() {
    const collections = new Map();
    return {
        collection(name) {
            if (!collections.has(name)) collections.set(name, new MemoryCollection(name));
            return collections.get(name);
        },
    };
}
