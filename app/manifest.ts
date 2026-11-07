import type {MetadataRoute} from 'next';

/**
 * Phase 005 Stage 7 — Installable PWA Manifest for Samsung Android & Desktop browsers.
 * Provides home-screen shortcut metadata only; deliberately registers zero service workers
 * so private financial records, broker snapshots, and Clerk tokens are never cached offline.
 */
export default function manifest():MetadataRoute.Manifest{
 return {
  name:'AI Capital Intelligence',
  short_name:'Capital Intel',
  description:'Evidence-first AI capital intelligence, portfolio command centre, and remote research operations.',
  start_url:'/',
  scope:'/',
  display:'standalone',
  background_color:'#0b1020',
  theme_color:'#0b1020',
  orientation:'any',
 };
}
