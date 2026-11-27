import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
export const collections = {
  docs: defineCollection({
    loader: glob({pattern:'**/*.{md,mdx}',base:'./src/content/docs',generateId:({entry,data})=>typeof data.slug==='string'?data.slug:entry.replace(/\.(md|mdx)$/,'').toLowerCase().replace(/\/index$/,'')}),
    schema:z.object({title:z.string(),description:z.string().optional(),slug:z.string().optional(),sidebar:z.object({order:z.number().optional(),label:z.string().optional(),hidden:z.boolean().optional()}).optional()}).passthrough(),
  }),
};
