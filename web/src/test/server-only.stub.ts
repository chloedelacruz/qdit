/**
 * Stands in for the `server-only` package under Vitest.
 *
 * `server-only` ships two entry points and picks between them with the
 * `react-server` export condition. Next sets that condition when bundling a
 * Server Component; Vitest does not, so the import resolves to the guard entry
 * whose whole job is to throw "This module cannot be imported from a Client
 * Component module".
 *
 * Aliasing it to nothing is the right fix rather than dropping the import from
 * the modules under test: the import is what stops `node:crypto` reaching the
 * browser bundle, and that protection should hold in the real build whether or
 * not a test runner understands it.
 */
export {};
