'use strict';
/* global $, TMMapHistory */
/* eslint quotes:0, no-alert:0 */

(function(){
  const page = document.querySelector('.maps-page');
  if (!page) return;

  const listElement = document.getElementById('my-maps-list');
  const emptyElement = document.getElementById('my-maps-empty');
  const noResultsElement = document.getElementById('my-maps-no-results');
  const clearButton = document.getElementById('my-maps-clear');
  const liveElement = document.getElementById('my-maps-live');
  const searchInput = document.getElementById('my-maps-search');
  const statusFilter = document.getElementById('my-maps-status-filter');
  const typeFilter = document.getElementById('my-maps-type-filter');

  function text(name) {
    return page.dataset[name] || '';
  }

  function statusLabel(status) {
    const labels = {
      'in-progress': text('statusInProgress'),
      'ready': text('statusReady'),
      'failed': text('statusFailed'),
      'unavailable': text('statusUnavailable')
    };
    return labels[status] || labels['in-progress'];
  }

  function contentLabel(mode) {
    const labels = {
      'normal': text('contentNormal'),
      'no-buildings': text('contentNoBuildings'),
      'only-big-roads': text('contentOnlyBigRoads'),
      'only-named-roads': text('contentOnlyNamedRoads')
    };
    return labels[mode] || labels.normal;
  }

  function announce(message) {
    liveElement.textContent = '';
    window.setTimeout(function(){ liveElement.textContent = message; }, 20);
  }

  function element(tag, className, value) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (value !== undefined) result.textContent = value;
    return result;
  }

  function actionButton(label, className) {
    const button = element('button', className || '', label);
    button.type = 'button';
    return button;
  }

  function actionLabel(action, record) {
    return action + ': ' + TMMapHistory.displayName(record);
  }

  // Recent maps use elapsed minutes/hours; older maps use local calendar days.
  function formattedDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const exact = new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
      dateStyle: 'medium', timeStyle: 'short'
    }).format(date);
    const today = new Date();
    const days = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
    const elapsed = Math.max(0, Date.now() - date.getTime());
    const formatter = new Intl.RelativeTimeFormat(document.documentElement.lang || undefined, {numeric: 'auto'});
    let relative;
    if (elapsed < 60000) relative = text('momentsAgo');
    else if (elapsed < 3600000) relative = formatter.format(-Math.floor(elapsed / 60000), 'minute');
    else if (elapsed < 7200000) relative = text('hourAgo');
    else if (elapsed < 21600000) relative = formatter.format(-Math.floor(elapsed / 3600000), 'hour');
    else relative = formatter.format(days, 'day');
    return relative.charAt(0).toLocaleUpperCase(document.documentElement.lang || undefined) + relative.slice(1) + ' (' + exact + ')';
  }

  function addDefinition(list, term, description) {
    if (description === undefined || description === null || description === '') return;
    if (list.children.length) {
      const separator = element('span', '', ' — ');
      separator.setAttribute('aria-hidden', 'true');
      list.appendChild(separator);
    }
    const field = element('span', 'my-map-field');
    field.append(element('span', 'visuallyhidden', term + ': '), document.createTextNode(description));
    list.appendChild(field);
  }

  // Use decorative vector icons; the native controls retain localized names.
  function icon(name) {
    const paths = {
      edit: 'M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z',
      remove: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
      favorite: 'M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z',
      share: 'M8 11l8-5M8 13l8 5M8 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0M22 4a3 3 0 1 1-6 0 3 3 0 0 1 6 0M22 20a3 3 0 1 1-6 0 3 3 0 0 1 6 0'
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'my-map-icon');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', paths[name]);
    svg.appendChild(path);
    return svg;
  }

  // Restore settings and enter either normal editing or one-time automatic retry.
  function openSettings(record, retry) {
    if (!retry && record.request.excludedFeatures && record.request.excludedFeatures.length &&
        !window.confirm(text('variationConfirm'))) return;
    try {
      if (!TMMapHistory.restoreSettings(record.id)) return;
      if (retry) window.sessionStorage.setItem('tm-map-history-auto-retry', record.id);
    } catch (_error) {
      announce(text('storageError'));
      return;
    }
    window.location.href = 'area';
  }

  // Copy a visible share URL while leaving it selected as a manual fallback.
  function copyShareUrl(input, status) {
    input.focus();
    input.select();
    const copied = function(){
      status.textContent = text('linkCopied');
      announce(text('linkCopied'));
    };
    const manual = function(){ status.textContent = text('copyManually'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(input.value).then(copied).catch(manual);
      return;
    }
    try {
      if (document.execCommand('copy')) copied();
      else manual();
    } catch (_error) {
      manual();
    }
  }

  // Reveal a durable share URL so the action always has visible feedback.
  function shareRecord(article, record) {
    let panel = article.querySelector('.my-map-share-panel');
    if (panel) {
      panel.hidden = false;
      const existingInput = panel.querySelector('input');
      copyShareUrl(existingInput, panel.querySelector('.my-map-share-status'));
      return;
    }
    panel = element('div', 'my-map-share-panel');
    const inputId = 'map-share-' + record.id;
    const label = element('label', '', text('shareUrl'));
    label.htmlFor = inputId;
    const input = element('input');
    input.id = inputId;
    input.type = 'url';
    input.readOnly = true;
    input.value = TMMapHistory.permaUrl(record);
    const copy = actionButton(text('copyLink'));
    const status = element('p', 'my-map-share-status');
    status.setAttribute('role', 'status');
    copy.addEventListener('click', function(){ copyShareUrl(input, status); });
    panel.append(label, input, copy, status);
    article.appendChild(panel);
    copyShareUrl(input, status);
  }

  // Open an accessible inline editor for the personal name and note.
  function editRecord(item, record) {
    const existing = item.querySelector('.my-map-edit-form');
    if (existing) {
      existing.hidden = false;
      existing.querySelector('input').focus();
      return;
    }
    const form = element('form', 'my-map-edit-form');
    const nameId = 'map-name-' + record.id;
    const noteId = 'map-note-' + record.id;
    const nameLabel = element('label', '', text('name'));
    nameLabel.htmlFor = nameId;
    const nameInput = element('input');
    nameInput.id = nameId;
    nameInput.maxLength = 120;
    const defaultName = record.addressShort || record.addressLong || '';
    nameInput.value = record.name || defaultName;
    const noteLabel = element('label', '', text('note'));
    noteLabel.htmlFor = noteId;
    const noteInput = element('textarea');
    noteInput.id = noteId;
    noteInput.maxLength = 500;
    noteInput.value = record.note || '';
    const actions = element('div', 'my-map-edit-form-actions');
    const save = actionButton(text('save'), 'primary-action');
    save.type = 'submit';
    const cancel = actionButton(text('cancel'));
    actions.append(save, cancel);
    form.append(nameLabel, nameInput, noteLabel, noteInput, actions);
    item.appendChild(form);
    form.addEventListener('submit', function(event){
      event.preventDefault();
      const enteredName = nameInput.value.trim();
      const result = TMMapHistory.update(record.id, {
        name: enteredName === defaultName ? '' : enteredName,
        note: noteInput.value.trim()
      });
      if (!result.ok) {
        announce(text('storageError'));
        return;
      }
      render(record.id);
    });
    cancel.addEventListener('click', function(){
      form.hidden = true;
      item.querySelector('.edit-action').focus();
    });
    nameInput.focus();
  }

  // Build one self-contained list item whose controls remain meaningful out of context.
  function renderRecord(record) {
    const item = element('li', 'my-map-item');
    item.dataset.mapId = record.id;
    const article = element('article');
    const address = record.addressLong || record.addressShort || '';
    const firstPart = address.split(',')[0].trim();
    const name = record.name || firstPart || TMMapHistory.displayName(record);
    const rest = record.name && record.name !== firstPart ? address : address.slice(firstPart.length).replace(/^,\s*/, '');
    const heading = element('h3', '', name);
    heading.tabIndex = -1;
    const headingRow = element('div', 'my-map-heading');
    const status = element('p', 'my-map-status my-map-status-' + record.status, statusLabel(record.status));
    status.hidden = record.status === 'ready';
    headingRow.appendChild(heading);
    if (rest) headingRow.appendChild(element('span', 'my-map-address', ', ' + rest));
    headingRow.appendChild(status);
    article.appendChild(headingRow);
    const details = element('ul', 'my-map-details');
    details.setAttribute('role', 'list');
    const request = record.request || {};
    const createdTerm = element('span', 'visuallyhidden', text(record.source === 'shared' ? 'saved' : 'created') + ' ');
    const createdValue = element('li');
    const time = element('time', 'my-map-time', formattedDate(record.createdAt));
    time.dateTime = record.createdAt;
    createdValue.append(createdTerm, time);
    details.appendChild(createdValue);
    const printing = element('li', 'my-map-printing');
    if (request.printWidthCm && request.printHeightCm) {
      addDefinition(printing, text('size'), request.printWidthCm + ' × ' + request.printHeightCm + ' cm');
    }
    if (request.scale) addDefinition(printing, text('scale'), '1:' + request.scale);
    addDefinition(printing, text('mapType'), request.printingTech === '2d' ? text('typeTwo') : text('typeThree'));
    details.appendChild(printing);
    if (!request.multipartMode && request.contentMode && request.contentMode !== 'normal') {
      const content = element('li', 'my-map-content');
      addDefinition(content, text('content'), contentLabel(request.contentMode));
      details.appendChild(content);
    }
    if (request.multipartMode) {
      details.appendChild(element('li', 'my-map-multipart', text('partShift').replace('__multipart__', text('multipart'))
        .replace('__x__', request.multipartXpc || 0).replace('__y__', request.multipartYpc || 0)));
    }
    if (request.offsetX || request.offsetY) {
      details.appendChild(element('li', 'my-map-offset', text('locationShift')
        .replace('__x__', request.offsetX || 0).replace('__y__', request.offsetY || 0)));
    }
    if (request.coordinatesAdjusted || request.offsetX || request.offsetY) {
      details.appendChild(element('li', 'my-map-coordinates',
        text(request.coordinatesAdjusted ? 'adjustedCoordinates' : 'referenceCoordinates') + ': ' +
        text('latitude') + ' ' + request.lat + ', ' + text('longitude') + ' ' + request.lon));
    }
    article.appendChild(details);
    if (record.note) article.appendChild(element('p', 'my-map-note', record.note));
    if (record.status === 'failed') {
      article.appendChild(element('p', 'my-map-error', text(record.errorCode === 'too_large' ? 'failureTooLarge' : 'failureUnknown')));
    }
    if (record.status === 'unavailable') {
      article.appendChild(element('p', 'my-map-unavailable-help', text('filesUnavailableHelp')));
    }
    const progressText = element('p', 'my-map-progress');
    if (record.status === 'in-progress') progressText.textContent = progressDescription(record);
    article.appendChild(progressText);

    const actions = element('div', 'my-map-actions');
    if (record.status === 'ready') {
      const open = element('a', 'primary-action', text('open'));
      open.href = 'map?map=' + encodeURIComponent(record.id);
      open.setAttribute('aria-label', actionLabel(text('open'), record));
      actions.appendChild(open);
    } else if (record.status === 'in-progress') {
      const review = actionButton(text('reviewProgress'), 'primary-action');
      review.setAttribute('aria-label', actionLabel(text('reviewProgress'), record));
      review.addEventListener('click', function(){ refreshRecord(record, true); });
      actions.appendChild(review);
      const retry = actionButton(text('tryAgain'));
      retry.setAttribute('aria-label', actionLabel(text('tryAgain'), record));
      retry.addEventListener('click', function(){
        if (window.confirm(text('retryConfirm'))) openSettings(record, true);
      });
      actions.appendChild(retry);
    } else if (record.status === 'failed') {
      const retry = actionButton(text('tryAgain'), 'primary-action');
      retry.setAttribute('aria-label', actionLabel(text('tryAgain'), record));
      retry.addEventListener('click', function(){ openSettings(record, true); });
      actions.appendChild(retry);
    } else {
      const review = actionButton(text('reviewUnavailable'), 'primary-action');
      review.setAttribute('aria-label', actionLabel(text('reviewUnavailable'), record));
      review.addEventListener('click', function(){ openSettings(record, false); });
      actions.appendChild(review);
    }

    if (record.status === 'ready' && request.excludedFeatures && request.excludedFeatures.length) {
      const repeat = actionButton(text('tryAgain'));
      repeat.setAttribute('aria-label', actionLabel(text('tryAgain'), record));
      repeat.addEventListener('click', function(){ openSettings(record, true); });
      actions.appendChild(repeat);
    }
    const variation = actionButton(record.status === 'failed' || record.status === 'unavailable'
      ? text('changeSettings') : text('createVariation'));
    variation.setAttribute('aria-label', actionLabel(variation.textContent, record));
    variation.addEventListener('click', function(){ openSettings(record, false); });
    const edit = actionButton('', 'edit-action my-map-icon-button');
    edit.setAttribute('aria-label', actionLabel(text('edit'), record));
    edit.title = actionLabel(text('edit'), record);
    edit.appendChild(icon('edit'));
    headingRow.insertBefore(edit, status);
    edit.addEventListener('click', function(){ editRecord(item, record); });
    const favorite = actionButton(record.favorite ? text('unfavorite') : text('favorite'));
    favorite.setAttribute('aria-label', actionLabel(favorite.textContent, record));
    favorite.setAttribute('aria-pressed', String(!!record.favorite));
    favorite.prepend(icon('favorite'), document.createTextNode(' '));
    favorite.addEventListener('click', function(){
      const result = TMMapHistory.update(record.id, {favorite: !record.favorite});
      if (result.ok) render(record.id); else announce(text('storageError'));
    });
    const share = actionButton(text('share'));
    share.setAttribute('aria-label', actionLabel(text('share'), record));
    share.prepend(icon('share'), document.createTextNode(' '));
    share.addEventListener('click', function(){ shareRecord(article, record); });
    const remove = actionButton('', 'remove-action my-map-icon-button');
    remove.setAttribute('aria-label', actionLabel(text('remove'), record));
    remove.title = actionLabel(text('remove'), record);
    remove.appendChild(icon('remove'));
    remove.addEventListener('click', function(){
      if (!window.confirm(text('removeConfirm').replace('__map__', TMMapHistory.displayName(record)))) return;
      const next = item.nextElementSibling || item.previousElementSibling;
      const focusId = next && next.dataset.mapId;
      const result = TMMapHistory.remove(record.id);
      if (!result.ok) {
        announce(text('storageError'));
        return;
      }
      render(focusId);
      const focusItem = focusId && listElement.querySelector('[data-map-id="' + focusId + '"] h3');
      (focusItem || searchInput).focus();
      announce(text('removed').replace('__map__', TMMapHistory.displayName(record)));
    });
    actions.append(variation, favorite, share);
    article.appendChild(remove);
    article.appendChild(actions);
    item.appendChild(article);
    return item;
  }

  function filteredRecords(records) {
    const query = searchInput.value.trim().toLocaleLowerCase();
    return records.filter(function(record){
      const haystack = [record.name, record.addressShort, record.addressLong, record.note]
        .join(' ').toLocaleLowerCase();
      return (!query || haystack.indexOf(query) !== -1) &&
        (!statusFilter.value || record.status === statusFilter.value) &&
        (!typeFilter.value || (record.request || {}).printingTech === typeFilter.value);
    });
  }

  // Render favorites first, then newest first, while preserving the active item when possible.
  function render(focusId) {
    const records = TMMapHistory.list().sort(function(left, right){
      if (!!left.favorite !== !!right.favorite) return left.favorite ? -1 : 1;
      return String(right.createdAt).localeCompare(String(left.createdAt));
    });
    const visible = filteredRecords(records);
    listElement.replaceChildren();
    visible.forEach(function(record){ listElement.appendChild(renderRecord(record)); });
    emptyElement.hidden = records.length !== 0;
    noResultsElement.hidden = records.length === 0 || visible.length !== 0;
    clearButton.disabled = records.length === 0;
    const readable = TMMapHistory.readable();
    document.getElementById('my-maps-storage-error').hidden = readable;
    if (!readable) {
      emptyElement.hidden = true;
      clearButton.disabled = false;
    }
    if (focusId) {
      const heading = listElement.querySelector('[data-map-id="' + focusId + '"] h3');
      if (heading) heading.focus();
    }
  }

  function progressDescription(record) {
    if (record.progress >= 80) return text('progressUploading');
    if (record.progress >= 60) return text('progressConverting');
    if (record.progress >= 20) return text('progressReading');
    return text('checkPending');
  }

  // Update only the affected card. Background work never rebuilds active editors
  // or steals focus; controls are reconciled once the user leaves the card.
  async function refreshRecord(record, announceResult) {
    let message = '';
    try {
      const result = await TMMapHistory.refresh(record.id);
      if (result && !result.ok) message = text('storageError');
    } catch (_error) { message = text('checkPending'); }
    const refreshed = TMMapHistory.find(record.id);
    const item = Array.from(listElement.children).find(function(child){ return child.dataset.mapId === record.id; });
    if (!item) return;
    if (!refreshed) {
      const hadFocus = item.contains(document.activeElement);
      const neighbor = item.nextElementSibling || item.previousElementSibling;
      item.remove();
      if (hadFocus) (neighbor ? neighbor.querySelector('h3') : searchInput).focus();
      const remaining = TMMapHistory.list().length;
      emptyElement.hidden = remaining !== 0;
      clearButton.disabled = !remaining;
      noResultsElement.hidden = !remaining || listElement.children.length !== 0;
      announce(text('removed').replace('__map__', TMMapHistory.displayName(record)));
      return;
    }
    const badge = item.querySelector('.my-map-status');
    badge.textContent = statusLabel(refreshed.status);
    badge.hidden = refreshed.status === 'ready';
    badge.className = 'my-map-status my-map-status-' + refreshed.status;
    item.querySelector('.my-map-progress').textContent = message ||
      (refreshed.status === 'in-progress' ? progressDescription(refreshed) : '');
    const reconcile = function(){
      if (!item.isConnected || item.contains(document.activeElement) || item.querySelector('.my-map-edit-form:not([hidden])')) return;
      const current = TMMapHistory.find(record.id);
      if (!current || !filteredRecords([current]).length) {
        item.remove();
        noResultsElement.hidden = !TMMapHistory.list().length || listElement.children.length !== 0;
        return;
      }
      const replacement = renderRecord(current);
      replacement.querySelector('.my-map-progress').textContent = message ||
        (refreshed.status === 'in-progress' ? progressDescription(refreshed) : '');
      item.replaceWith(replacement);
    };
    reconcile();
    item.addEventListener('focusout', function(){ window.setTimeout(reconcile, 0); });
    if (announceResult || record.status !== refreshed.status) {
      announce(message || text('statusUpdated').replace('__status__', statusLabel(refreshed.status)));
    }
  }

  // Refresh remotely meaningful states when the library opens.
  function refreshAll() {
    const pending = TMMapHistory.list();
    function worker() {
      const next = pending.shift();
      return next ? refreshRecord(next, false).then(worker) : Promise.resolve();
    }
    for (let index = 0; index < 4; index++) worker();
  }

  [searchInput, statusFilter, typeFilter].forEach(function(control){
    control.addEventListener(control === searchInput ? 'input' : 'change', function(){ render(); });
  });
  clearButton.addEventListener('click', function(){
    if (!window.confirm(text('clearConfirm'))) return;
    const result = TMMapHistory.clear();
    if (!result.ok) {
      announce(text('storageError'));
      return;
    }
    render();
    searchInput.focus();
    announce(text('cleared'));
  });

  render();
  refreshAll();
  // Keep relative labels current without rebuilding cards or announcing every tick.
  window.setInterval(function(){
    listElement.querySelectorAll('.my-map-time').forEach(function(time){
      time.textContent = formattedDate(time.dateTime);
    });
  }, 60000);
  window.addEventListener('pageshow', function(event){
    if (event.persisted) refreshAll();
  });
  $('.show-on-load').show();
})();
