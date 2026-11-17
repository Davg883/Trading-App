// Negative-control fixture for tests/server-client-import-boundary.test.ts: reproduces the G9.3.3 defect shape (a
// server route importing claim validation from the 'use client' module). Never imported by application code.
export { validateClerkConvexJwtClaims } from '../../../lib/clerk-convex-auth';
