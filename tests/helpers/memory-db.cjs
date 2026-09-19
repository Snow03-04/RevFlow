const { randomUUID } = require("node:crypto");
// A disposable database with PostgREST's default 1,000-row response limit.
// It has no network or credentials; mutations only change these cloned arrays.
function memoryDb(source = {}) {
  const tables = structuredClone(source);
  const writes = [];
  return {
    tables,
    writes,
    from(table) {
      const filters = [],
        ordering = [];
      let start = 0,
        end = 999,
        single = false,
        mode = "select",
        payload,
        conflict,
        columns = "*",
        returning = false;
      const q = {
        select(value = "*") {
          columns = value;
          if (mode === "upsert") returning = true;
          return q;
        },
        eq(k, v) {
          filters.push((r) => r[k] === v);
          return q;
        },
        neq(k, v) {
          filters.push((r) => r[k] !== v);
          return q;
        },
        is(k, v) {
          filters.push((r) => (r[k] ?? null) === v);
          return q;
        },
        not(k, op, v) {
          if (op !== "is") throw Error(op);
          filters.push((r) => (r[k] ?? null) !== v);
          return q;
        },
        in(k, vs) {
          filters.push((r) => vs.includes(r[k]));
          return q;
        },
        gte(k, v) {
          filters.push((r) => r[k] >= v);
          return q;
        },
        lte(k, v) {
          filters.push((r) => r[k] <= v);
          return q;
        },
        like(k, pattern) {
          const regex = new RegExp("^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$");
          filters.push((r) => regex.test(r[k] ?? ""));
          return q;
        },
        lt(k, v) {
          filters.push((r) => r[k] < v);
          return q;
        },
        order(k, o = {}) {
          ordering.push([k, o.ascending !== false]);
          return q;
        },
        range(a, b) {
          start = a;
          end = b;
          return q;
        },
        limit(n) {
          end = start + n - 1;
          return q;
        },
        single() {
          single = true;
          return q;
        },
        maybeSingle() {
          single = true;
          return q;
        },
        upsert(rows, opts = {}) {
          mode = "upsert";
          payload = Array.isArray(rows) ? rows : [rows];
          conflict = (opts.onConflict ?? "id").split(",");
          return q;
        },
        update(row) {
          mode = "update";
          payload = row;
          return q;
        },
        then(resolve, reject) {
          return Promise.resolve()
            .then(() => {
              const data = tables[table] ?? [];
              if (mode === "update") {
                for (const row of data.filter((r) => filters.every((f) => f(r)))) Object.assign(row, payload);
                writes.push({ table, rows: structuredClone(payload) });
                return { data: null, error: null };
              }
              if (mode === "upsert") {
                for (const row of payload) {
                  const old = data.find((r) =>
                    conflict.every((k) => r[k] === row[k]),
                  );
                  if (old) Object.assign(old, row);
                  else data.push({ id: randomUUID(), ...row });
                }
                tables[table] = data;
                writes.push({ table, rows: structuredClone(payload) });
                const saved = returning
                  ? structuredClone(
                      data.filter((r) =>
                        payload.some((row) =>
                          conflict.every((k) => r[k] === row[k]),
                        ),
                      ),
                    )
                  : null;
                return {
                  data: single ? (saved?.[0] ?? null) : saved,
                  error: null,
                };
              }
              let out = data.filter((r) => filters.every((f) => f(r)));
              out.sort((a, b) => {
                for (const [key, asc] of ordering) {
                  const d = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
                  if (d) return asc ? d : -d;
                }
                return 0;
              });
              out = structuredClone(out.slice(start, end + 1));
              if (columns.includes("orders("))
                out = out.map((r) => ({
                  ...r,
                  orders:
                    tables.orders?.find((o) => o.id === r.order_id) ?? null,
                }));
              return { data: single ? (out[0] ?? null) : out, error: null };
            })
            .then(resolve, reject);
        },
      };
      return q;
    },
  };
}
module.exports = { memoryDb };
