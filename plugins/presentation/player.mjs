/**
 * PURPOSE: The runtime a rendered document carries — the deck player and the
 *          dashboard's small entrance script. Both are plain classic scripts
 *          (no modules, no imports), because the document preview mounts a page
 *          in a sandboxed frame where a relative module URL cannot resolve.
 * INPUTS:  the markup render-deck.mjs / render-board.mjs wrote: `.slide`
 *          sections, `[data-frag]`, `[data-count]`, `[data-draw]`, `.board`.
 * OUTPUTS: `PLAYER_JS` and `BOARD_JS` as source strings the renderer inlines.
 *          Nothing is fetched and no storage is touched: an opaque origin refuses
 *          both, and a deck that needs them is not a document.
 * KEYWORDS: presentation, deck, player, keyboard, fragments, animation, runtime.
 */

/**
 * Count-up shared by the deck and the board: every `[data-count]` element walks
 * from 0 to its `data-count` target and keeps the suffix it was rendered with.
 * The element already holds the final text, so a browser that refuses animation
 * still shows the right number.
 */
const COUNT_JS = `
  function countUp(root){
    var nodes = root.querySelectorAll('[data-count]');
    for (var i = 0; i < nodes.length; i++){
      (function(node){
        var target = parseFloat(node.getAttribute('data-count'));
        var suffix = node.getAttribute('data-count-suffix') || '';
        var digits = parseInt(node.getAttribute('data-count-digits') || '0', 10);
        if (!isFinite(target)) return;
        var start = null;
        var duration = 700;
        function frame(now){
          if (start === null) start = now;
          var t = Math.min(1, (now - start) / duration);
          var eased = 1 - Math.pow(1 - t, 3);
          var value = target * eased;
          var text = digits > 0 ? value.toFixed(digits) : String(Math.round(value));
          node.textContent = text + suffix;
          if (t < 1) window.requestAnimationFrame(frame);
          else node.textContent = (digits > 0 ? target.toFixed(digits) : String(Math.round(target))) + suffix;
        }
        node.textContent = (digits > 0 ? (0).toFixed(digits) : '0') + suffix;
        window.requestAnimationFrame(frame);
      })(nodes[i]);
    }
  }
`

/**
 * The deck player. Slides are sections inside one fixed 1600×900 stage; the
 * player scales that stage to the viewport, moves between slides, reveals
 * fragments one advance at a time, and keeps the URL hash in step so a slide can
 * be linked.
 */
export const PLAYER_JS = `(function(){
  'use strict';
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var stage = document.querySelector('.stage');
  var bar = document.querySelector('.deck-progress__bar');
  var notes = document.querySelector('.deck-notes');
  var overview = document.querySelector('.deck-overview');
  var counter = 0;
  var current = 0;

  function fit(){
    if (!stage) return;
    var w = window.innerWidth || 1600;
    var h = window.innerHeight || 900;
    var scale = Math.min(w / 1600, h / 900);
    stage.style.transform = 'scale(' + scale + ')';
  }

  function resetFragments(slide){
    var frags = slide.querySelectorAll('[data-frag]');
    for (var i = 0; i < frags.length; i++) frags[i].classList.remove('is-here');
  }

  function revealNextFragment(slide){
    var frags = slide.querySelectorAll('[data-frag]');
    for (var i = 0; i < frags.length; i++){
      if (!frags[i].classList.contains('is-here')){ frags[i].classList.add('is-here'); return true; }
    }
    return false;
  }

  function measureDraw(slide){
    var groups = slide.querySelectorAll('[data-draw]');
    for (var i = 0; i < groups.length; i++){
      var nodes = groups[i].querySelectorAll('path, line, polyline, circle');
      for (var j = 0; j < nodes.length; j++){
        var node = nodes[j];
        if (node.hasAttribute('pathLength')) continue;
        try {
          var len = node.getTotalLength ? node.getTotalLength() : 1200;
          node.style.setProperty('--len', String(Math.ceil(len)));
        } catch (error) { /* a shape without a length keeps the default dash */ }
      }
    }
  }

  function show(index, fromHash){
    if (!slides.length) return;
    current = Math.max(0, Math.min(slides.length - 1, index));
    for (var i = 0; i < slides.length; i++){
      var slide = slides[i];
      var on = i === current;
      slide.classList.toggle('is-current', on);
      slide.setAttribute('aria-hidden', on ? 'false' : 'true');
      if (on){
        slide.classList.remove('is-in');
        resetFragments(slide);
        measureDraw(slide);
        countUp(slide);
        void slide.offsetWidth;
        slide.classList.add('is-in');
      } else {
        slide.classList.remove('is-in');
      }
    }
    if (bar) bar.style.width = String(((current + 1) / slides.length) * 100) + '%';
    if (notes){
      var note = slides[current].getAttribute('data-note') || '';
      notes.innerHTML = note === '' ? '<em>Заметки</em>Нет заметок к этому слайду.' : '<em>Заметки</em>' + note;
    }
    var items = overview ? overview.querySelectorAll('.deck-overview__item') : [];
    for (var k = 0; k < items.length; k++) items[k].classList.toggle('is-current', k === current);
    if (!fromHash){
      var next = '#' + (current + 1);
      if (window.location.hash !== next){
        try { history.replaceState(null, '', next); } catch (error) { window.location.hash = next; }
      }
    }
    counter = 0;
  }

  function next(){
    var slide = slides[current];
    if (slide && revealNextFragment(slide)) { counter += 1; return; }
    if (current < slides.length - 1) show(current + 1);
  }

  function prev(){
    var slide = slides[current];
    var frags = slide ? slide.querySelectorAll('[data-frag].is-here') : [];
    if (frags.length > 0){ frags[frags.length - 1].classList.remove('is-here'); return; }
    if (current > 0) show(current - 1);
  }

  function toggle(className){
    document.body.classList.toggle(className);
    if (className === 'is-overview') buildOverview();
  }

  function buildOverview(){
    if (!overview || overview.getAttribute('data-built') === '1') return;
    for (var i = 0; i < slides.length; i++){
      var item = document.createElement('div');
      item.className = 'deck-overview__item';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label', 'Слайд ' + (i + 1));
      var number = document.createElement('b');
      number.textContent = String(i + 1);
      var label = document.createElement('span');
      label.textContent = slides[i].getAttribute('data-title') || '';
      item.appendChild(number);
      item.appendChild(label);
      (function(index, node){
        node.addEventListener('click', function(){ document.body.classList.remove('is-overview'); show(index); });
        node.addEventListener('keydown', function(event){
          if (event.key === 'Enter' || event.key === 'Space'){ event.preventDefault(); document.body.classList.remove('is-overview'); show(index); }
        });
      })(i, item);
      overview.appendChild(item);
    }
    overview.setAttribute('data-built', '1');
  }

  function slideFromHash(){
    var match = /^#(\\d+)$/.exec(window.location.hash || '');
    if (match === null) return 0;
    return Math.min(slides.length - 1, Math.max(0, parseInt(match[1], 10) - 1));
  }

  document.addEventListener('keydown', function(event){
    var key = event.key;
    if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || key === ' ' || key === 'Enter'){ event.preventDefault(); next(); }
    else if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp'){ event.preventDefault(); prev(); }
    else if (key === 'Home'){ event.preventDefault(); show(0); }
    else if (key === 'End'){ event.preventDefault(); show(slides.length - 1); }
    else if (key === 'o' || key === 'O' || key === 'о' || key === 'О'){ event.preventDefault(); toggle('is-overview'); }
    else if (key === 'n' || key === 'N' || key === 'т' || key === 'Т'){ event.preventDefault(); toggle('is-notes'); }
    else if (key === 'f' || key === 'F' || key === 'а' || key === 'А'){ event.preventDefault(); fullscreen(); }
    else if (key === 'Escape'){ document.body.classList.remove('is-overview'); document.body.classList.remove('is-notes'); }
    else if (/^[1-9]$/.test(key)){ event.preventDefault(); show(parseInt(key, 10) - 1); }
  });

  function fullscreen(){
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) {
        var request = document.documentElement.requestFullscreen();
        if (request && request.catch) request.catch(function(){});
      }
    } catch (error) { /* a sandboxed frame may refuse fullscreen; the deck still works */ }
  }

  document.addEventListener('click', function(event){
    var target = event.target;
    var action = target.closest ? target.closest('[data-deck-action]') : null;
    if (action !== null){
      var name = action.getAttribute('data-deck-action');
      if (name === 'next') next();
      else if (name === 'prev') prev();
      else if (name === 'overview') toggle('is-overview');
      else if (name === 'notes') toggle('is-notes');
      else if (name === 'fullscreen') fullscreen();
      return;
    }
    // A click on the slide advances it: inside the Sidebar preview the frame owns
    // the keyboard only after it is clicked, so the click also gives the reader
    // the control they expect without a hint.
    if (target.closest && target.closest('a, button, input, textarea, select, pre, code, .deck-overview, .deck-notes')) return;
    if (document.body.classList.contains('is-overview') || document.body.classList.contains('is-notes')) return;
    next();
  });

  window.addEventListener('resize', fit);
  window.addEventListener('hashchange', function(){ show(slideFromHash(), true); });
  fit();
  show(slideFromHash(), true);
  // No focus() on load: a sandboxed frame refuses focus without a user gesture
  // and says so in the console. A click on the slide focuses the document by
  // itself, which is the reader's first move anyway.
})();
${COUNT_JS}`

/**
 * The dashboard runtime: mark the board live so the CSS entrance runs, count the
 * tiles up, and let a click on a bar or a point show its exact value in the
 * tooltip line under the chart (a canvas SVG has no title, and a printed board
 * has no hover at all).
 */
export const BOARD_JS = `(function(){
  'use strict';
${COUNT_JS}
  function boot(){
    var board = document.querySelector('.board');
    if (board){
      board.classList.add('is-live');
      countUp(board);
    }
    var tip = document.querySelector('[data-board-tip]');
    if (!tip) return;
    var marks = document.querySelectorAll('[data-tip]');
    for (var i = 0; i < marks.length; i++){
      (function(mark){
        mark.addEventListener('mouseenter', function(){ tip.textContent = mark.getAttribute('data-tip'); });
        mark.addEventListener('focus', function(){ tip.textContent = mark.getAttribute('data-tip'); });
      })(marks[i]);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();`
