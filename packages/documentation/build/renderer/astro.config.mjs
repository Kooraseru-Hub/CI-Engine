import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import expressiveCode from 'astro-expressive-code';
import { unified } from '@astrojs/markdown-remark';
import documentationTypography from './typography.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(process.env.DOCS_ROOT || process.cwd());
const repository = process.env.GITHUB_REPOSITORY || '';
const [owner, name] = repository.split('/');
const projectSite = Boolean(owner && name);
const defaultBase = projectSite && name.toLowerCase() !== (owner + '.github.io').toLowerCase()
  ? '/' + name + '/' : '/';
const base = process.env.DOCS_BASE || defaultBase;
const site = process.env.DOCS_SITE || (owner
  ? 'https://' + owner.toLowerCase() + '.github.io'
  : 'https://example.com');
if (!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(base)) {
  throw new Error('DOCS_BASE must be a root-relative directory path ending in /');
}

export default defineConfig({
  srcDir: resolve(here, 'src'),
  // Prerendered server chunks must resolve dependencies from this package.
  outDir: resolve(here, 'dist'),
  cacheDir: resolve(repositoryRoot, process.env.DOCS_CACHE || 'build/cache/astro'),
  site,
  base,
  markdown: { processor: unified({ rehypePlugins: [documentationTypography] }) },
  integrations: [
    expressiveCode({
      themes: ['github-dark'],
      useDarkModeMediaQuery: false,
      styleOverrides: {borderRadius:'4px',codePaddingBlock:'12px',codePaddingInline:'16px',codeFontSize:'14px',codeLineHeight:'1.4'},
    }),
    mdx(),
  ],
  trailingSlash:'always',
});
