import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';

function resolveStarredPath() {
  const cwd = process.cwd();
  if (fsSync.existsSync(path.join(cwd, 'package.json'))) {
    return path.join(cwd, 'data', 'starred_layouts.json');
  }
  const uiPath = path.join(cwd, 'ui', 'data', 'starred_layouts.json');
  if (fsSync.existsSync(path.join(cwd, 'ui', 'package.json'))) {
    return uiPath;
  }
  return path.join(cwd, 'data', 'starred_layouts.json');
}

function classifyOrientation(w, h) {
  if (!w || !h) return 'landscape';
  const ratio = w / h;
  if (ratio > 1.1) return 'landscape';
  if (ratio < 0.9) return 'portrait';
  return 'square';
}

function getPhotoOrientations(photos = [], layoutObjects = []) {
  if (photos.length > 0) {
    return photos.map((p) =>
      classifyOrientation(p.w_in || p.photo_width, p.h_in || p.photo_height)
    );
  }
  return layoutObjects
    .filter((o) => o.type === 'photo_mat')
    .map((o) => classifyOrientation(o.photo_width, o.photo_height));
}

export async function loadStarredLayouts() {
  const filePath = resolveStarredPath();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function getMatchingStarredLayouts(photos = [], limit = 3) {
  const all = await loadStarredLayouts();
  if (all.length === 0) return { examples: [], totalStarred: 0 };

  const targetCount = photos.length;
  const targetOrientations = getPhotoOrientations(photos);

  const scored = all.map((entry) => {
    let score = entry.user_starred ? 5 : 0;
    if (entry.photo_count === targetCount) score += 10;
    else score -= Math.abs((entry.photo_count || 0) - targetCount) * 2;

    const entryOrientations = Array.isArray(entry.photo_orientations)
      ? entry.photo_orientations
      : [];
    const len = Math.min(targetOrientations.length, entryOrientations.length);
    for (let i = 0; i < len; i++) {
      if (targetOrientations[i] === entryOrientations[i]) score += 3;
    }

    return { entry, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const examples = scored.slice(0, limit).map(({ entry }) => ({
    archetype: entry.archetype || 'Curated Layout',
    photo_count: entry.photo_count,
    photo_orientations: entry.photo_orientations || [],
    design_notes: entry.design_notes || '',
    objects: entry.objects || [],
  }));

  return { examples, totalStarred: all.length };
}

export async function saveStarredLayout({
  layout,
  photos = [],
  theme = 'Scrapbook Page',
  prompt = '',
}) {
  if (!layout || !Array.isArray(layout.objects) || layout.objects.length === 0) {
    const err = new Error('Cannot star an empty layout.');
    err.status = 400;
    throw err;
  }

  const filePath = resolveStarredPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const existing = await loadStarredLayouts();

  const photoObjects = layout.objects.filter((o) => o.type === 'photo_mat');
  const annotatedObjects = layout.objects.map((obj) => {
    if (obj.type === 'photo_mat' || photoObjects.length === 0) {
      return { ...obj };
    }
    let nearest = photoObjects[0];
    let bestDist = Infinity;
    photoObjects.forEach((p) => {
      const dist = Math.hypot(obj.center_x - p.center_x, obj.center_y - p.center_y);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = p;
      }
    });
    return {
      ...obj,
      nearest_photo_id: nearest.id,
      dx_from_photo: Number((obj.center_x - nearest.center_x).toFixed(1)),
      dy_from_photo: Number((obj.center_y - nearest.center_y).toFixed(1)),
    };
  });

  const orientations = getPhotoOrientations(photos, layout.objects);
  const savedEntry = {
    id: `star_${Date.now()}`,
    user_starred: true,
    created_at: new Date().toISOString(),
    theme,
    prompt,
    archetype: layout.archetype || 'User-Starred Design',
    design_notes: layout.design_notes || 'Human-curated scrapbook layout saved for AI training.',
    photo_count: photoObjects.length || photos.length,
    photo_orientations: orientations,
    objects: annotatedObjects,
  };

  const updated = [...existing, savedEntry];
  await fs.writeFile(filePath, JSON.stringify(updated, null, 2), 'utf-8');
  return { savedEntry, totalStarred: updated.length };
}
