const test=require('node:test');
const assert=require('node:assert/strict');
const {newestFirst}=require('../src/core/download-order.cjs');

test('shows newer downloads before older queue and legacy records without changing execution order',()=>{
 const rows=[{id:'old',createdAt:100},{id:'same-first',createdAt:200},{id:'legacy',createdAt:150},{id:'same-second',createdAt:200}];
 assert.deepEqual(newestFirst(rows).map(row=>row.id),['same-first','same-second','legacy','old']);
 assert.deepEqual(rows.map(row=>row.id),['old','same-first','legacy','same-second']);
});
