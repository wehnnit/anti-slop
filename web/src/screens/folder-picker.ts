import { api } from '../api.js';
import type { DirEntry, ProjectRecord } from '../api.js';
import { toast } from '../ui.js';
import { button, el, icon, iconButton, linkButton, micro } from './shared.js';

export interface FolderPickerOptions {
  current?: string;
  existing?: ProjectRecord[];
  onChoose: (path: string, project?: ProjectRecord) => void;
  onProjectsChanged?: () => void;
}

export interface FolderPicker {
  element: HTMLElement;
  open(): Promise<void>;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

// One picker shared by the composer and the settings screen. It remembers the
// projects the user has already saved, so the common case is a single click
// rather than navigating the disk again.
export function folderPicker(options: FolderPickerOptions): FolderPicker {
  const element = el('section', { class: 'picker', hidden: true, 'aria-label': 'Choose a project folder' });

  const placesSlot = el('div', { class: 'picker-column picker-column--places' });
  const listSlot = el('div', { class: 'picker-column picker-column--list' });
  const crumb = el('p', { class: 'picker-crumb' }, 'Choose a folder');
  const selected = el('span', { class: 'picker-foot-path' }, 'Nothing yet');
  const useButton = button('Work in this folder', () => void choose(), { variant: 'primary', disabled: true });
  const saveButton = button('Save as project', () => void save(), { disabled: true });
  const hiddenToggle = linkButton('Show hidden folders', () => void browse(current, !showHidden));

  let current = options.current ?? '';
  let showHidden = false;
  let busy = false;

  function setBusy(value: boolean): void {
    busy = value;
    useButton.disabled = value || !current;
    saveButton.disabled = value || !current;
    selected.textContent = current || 'Nothing yet';
  }

  async function browse(path?: string, hidden = showHidden): Promise<void> {
    showHidden = hidden;
    hiddenToggle.textContent = hidden ? 'Hide hidden folders' : 'Show hidden folders';
    listSlot.replaceChildren(el('p', { class: 'picker-note' }, 'Reading folders'));
    try {
      const listing = await api.fs(path, hidden);
      current = listing.path;
      crumb.textContent = listing.path;
      setBusy(false);
      renderList(listing.parent, listing.dirs, listing.hiddenCount, listing.looksLikeProject);
    } catch (err) {
      current = '';
      setBusy(false);
      crumb.textContent = 'Could not read that folder';
      listSlot.replaceChildren(
        el('p', { class: 'picker-note picker-note--bad' }, err instanceof Error ? err.message : 'That folder could not be read.'),
      );
    }
  }

  function renderList(parent: string, dirs: DirEntry[], hiddenCount: number, hereIsProject: boolean): void {
    const rows: HTMLElement[] = [];
    const up = iconButton('Parent folder', 'M8 3v10M4 9l4 4 4-4', () => {
      if (parent !== current) void browse(parent);
    });
    up.disabled = parent === current;
    rows.push(el('div', { class: 'picker-row picker-row--nav' }, up, el('span', { class: 'picker-row-text picker-row-text--quiet' }, 'Up one level')));

    if (hereIsProject) {
      rows.push(
        el(
          'div',
          { class: 'picker-row picker-row--here' },
          el('span', { class: 'picker-row-mark', 'aria-hidden': 'true' }, icon('M3 8l3.5 3.5L13 5')),
          el('span', { class: 'picker-row-text' }, 'This folder looks like a project'),
        ),
      );
    }

    for (const dir of dirs) {
      rows.push(
        el(
          'button',
          { type: 'button', class: 'picker-row', 'on:click': () => void browse(dir.path) },
          el('span', { class: 'picker-row-mark', 'aria-hidden': 'true' }, dir.looksLikeProject ? '\u25c6' : '\u25b8'),
          el('span', { class: 'picker-row-text' }, dir.name),
          dir.looksLikeProject ? el('span', { class: 'picker-row-tag' }, 'project') : null,
        ),
      );
    }

    if (!dirs.length) {
      rows.push(el('p', { class: 'picker-note' }, 'No folders inside. You can still work in this one.'));
    }
    if (hiddenCount > 0 && !showHidden) {
      rows.push(
        el('p', { class: 'picker-note picker-note--quiet' }, String(hiddenCount) + ' hidden folder' + (hiddenCount === 1 ? '' : 's') + ' not shown.'),
      );
    }
    listSlot.replaceChildren(...rows);
  }

  async function choose(): Promise<void> {
    if (!current || busy) return;
    setBusy(true);
    try {
      const project = await api.createProject({ path: current });
      options.onChoose(project.path, project);
      options.onProjectsChanged?.();
      toast('Working folder set to ' + project.label + '.', 'ok');
      close();
    } catch (err) {
      setBusy(false);
      toast(err instanceof Error ? err.message : 'That folder could not be saved.', 'error');
    }
  }

  async function save(): Promise<void> {
    if (!current || busy) return;
    setBusy(true);
    try {
      const project = await api.createProject({ path: current });
      options.onProjectsChanged?.();
      toast('Saved ' + project.label + ' to your projects.', 'ok');
      setBusy(false);
      void renderPlaces();
    } catch (err) {
      setBusy(false);
      toast(err instanceof Error ? err.message : 'That folder could not be saved.', 'error');
    }
  }

  async function renderPlaces(): Promise<void> {
    const saved = options.existing?.slice() ?? [];
    const rows: HTMLElement[] = [];

    if (saved.length) {
      rows.push(micro('Your projects'));
      for (const project of saved) {
        rows.push(
          el(
            'button',
            { type: 'button', class: 'picker-place picker-place--project', 'data-path': project.path, 'on:click': () => pick(project) },
            el('span', { class: 'picker-place-name' }, project.label),
            el('span', { class: 'picker-place-path' }, project.path),
          ),
        );
      }
    }

    try {
      const places = await api.places();
      if (places.home.length) {
        rows.push(micro('Places'));
        for (const place of places.home) {
          rows.push(
            el(
              'button',
              { type: 'button', class: 'picker-place', 'data-path': place.path, 'on:click': () => void browse(place.path) },
              el('span', { class: 'picker-place-name' }, place.name),
              place.looksLikeProject ? el('span', { class: 'picker-row-tag' }, 'project') : null,
            ),
          );
        }
      }
    } catch {
      /* Places are a convenience. Browsing still works without them. */
    }

    if (!rows.length) rows.push(el('p', { class: 'picker-note' }, 'Browse to any folder below.'));
    placesSlot.replaceChildren(...rows);
  }

  function pick(project: ProjectRecord): void {
    current = project.path;
    options.onChoose(project.path, project);
    options.onProjectsChanged?.();
    close();
  }

  // Opens on the folder in use, or on Home when nothing has been chosen yet.
  // Starting inside the support folder would show an empty box, which reads
  // like a bug rather than a starting point.
  async function open(): Promise<void> {
    element.hidden = false;
    await renderPlaces();
    // Prefer the live selection, so reopening lands where the user last was
    // rather than back at the folder the picker was built with.
    const start = current || options.current;
    if (start) {
      void browse(start);
      return;
    }
    const candidates = Array.from(placesSlot.querySelectorAll<HTMLElement>('.picker-place'));
    const home = candidates.find(
      (node) => !node.classList.contains('picker-place--project') && node.dataset.path,
    );
    void browse(home?.dataset.path);
  }

  function close(): void {
    element.hidden = true;
  }

  element.append(
    el(
      'header',
      { class: 'picker-head' },
      el(
        'div',
        {},
        micro('Project folder'),
        el('p', { class: 'picker-lede' }, 'Pick any folder on this Mac. The team works inside it and nowhere else.'),
      ),
      linkButton('Close', close),
    ),
    el(
      'div',
      { class: 'picker-body' },
      placesSlot,
      el('div', { class: 'picker-column picker-column--browse' }, crumb, listSlot, hiddenToggle),
    ),
    el(
      'footer',
      { class: 'picker-foot' },
      el('div', { class: 'picker-foot-note' }, el('span', { class: 'picker-foot-label' }, 'Selected'), selected),
      el('div', { class: 'picker-foot-actions' }, saveButton, useButton),
    ),
  );

  setBusy(false);
  return {
    element,
    open,
    close,
    toggle: () => (element.hidden ? void open() : close()),
    isOpen: () => !element.hidden,
  };
}
