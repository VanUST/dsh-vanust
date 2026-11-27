/*
PROOF: the panel surface of the design map (AC-1, AC-2, AC-7) and the always-editable save path.
Behavior: in map mode the panel section carries `ps-main-map`, drops the body padding and page
  scroll, and the stage flexes to the panel body instead of a fixed 620 px box; the page editor
  has one toolbar with a Full screen control (requestFullscreen on the editor root, fullscreenchange
  keeps the state in step, Exit full screen returns) and no read/edit toggle; the frame is always
  an editor, a change is saved after the debounce through the host's `save` command, and the
  command writes the scene back to the one page file (a reload reads it).
Fails when: the 620 px ceiling or page scroll returns, the read/edit toggle returns, the canvas is
  built read-only, Full screen is dropped, or a saved scene does not reach the page file.
Production path: plugins/project-state-panel/client.js (map section + CSS),
  plugins/designmap/client/page-view.jsx, client/frame.js, client/host.js, src/command.mjs.
*/
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ROOT, argCase, commandHandler, pageFile, runCase, tempDesignmap, toolSurface,
} from './lib.mjs'

const CASE = argCase()
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const rule = (source, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`${escaped} \\{[^}]*\\}`))?.[0] ?? ''
}

runCase(CASE, async ({ check, equal, log }) => {
  const PANEL = read('plugins/project-state-panel/client.js')
  const PAGE = read('plugins/designmap/client/page-view.jsx')
  const FRAME = read('plugins/designmap/client/frame.js')
  const HOST = read('plugins/designmap/client/host.js')
  const COMMAND = read('plugins/designmap/src/command.mjs')

  if (CASE === 'AC-1') {
    const main = rule(PANEL, '.ps-main-map')
    const stage = rule(PANEL, '.ps-mapstage')
    const mapStage = rule(PANEL, '.ps-main-map .ps-mapstage')
    log('rules', JSON.stringify({ main, stage, mapStage }))
    check(main.includes('padding: 0'), `map mode removes the reading padding (${main})`)
    check(main.includes('overflow: hidden'), `map mode removes the page scroll (${main})`)
    check(main.includes('display: flex'), `map mode makes the body a flex column (${main})`)
    check(stage.includes('height: 100%'), `the stage fills its parent (${stage})`)
    check(stage.includes('border: 0'), `the stage is the body, not a bordered strip (${stage})`)
    check(!/min\(\s*64vh/.test(PANEL), 'the fixed 620 px / 64vh ceiling is gone from the panel styles')
    check(!/height:\s*min\(/.test(stage), `the stage has no fixed height cap (${stage})`)
    check(mapStage.includes('flex: 1'), `the stage is the flex child that grows with the window (${mapStage})`)
    check(/mode === 'map'[^\n]*ps-main-map/.test(PANEL), 'the map section carries ps-main-map only in map mode')
    check(/ps-mapstage[^\n]*data-designmap-page-editor|data-designmap-page-editor[^\n]*ps-mapstage/.test(PANEL), 'the page editor is mounted inside the map stage')
    return
  }

  if (CASE === 'AC-2') {
    check(PAGE.includes('requestFullscreen'), 'Full screen calls requestFullscreen on the editor root')
    check(PAGE.includes('fullscreenchange'), 'the editor listens for fullscreenchange (also the Esc exit path)')
    check(PAGE.includes('Exit full screen') && PAGE.includes('Full screen'), 'the control offers Full screen and Exit full screen')
    check(/setExpanded\([^)]*document\.fullscreenElement|document\.fullscreenElement[^)]*setExpanded|Boolean\(document\.fullscreenElement\)/.test(PAGE), 'the expanded state follows the browser fullscreen element, so Esc returns the layout')
    check(/data-expanded/.test(PAGE), 'the editor exposes which state it is in (data-expanded)')
    // The canvas is still an editor while expanded: the frame document is built once, editable,
    // and only the editor's own entry points (menu, help) are hidden - not the drawing toolbar.
    check(!/viewModeEnabled\s*:\s*true/.test(FRAME), 'the frame is not built read-only for the expanded state')
    check(!/\.App-toolbar[,{]/.test(FRAME), 'the drawing toolbar is not hidden by the expanded frame')
    check(/\.HintViewer/.test(FRAME) && /\.dropdown-menu-button/.test(FRAME) && /\.help-icon/.test(FRAME), 'only the menu/help entry points are hidden')
    check(!/editing\s*[:=]/.test(FRAME), 'the frame document has no read/edit mode switch')
    return
  }

  if (CASE === 'AC-7') {
    check(!/Edit mode: (on|off)/i.test(PAGE) && !/Read mode:/i.test(PAGE), 'the page editor renders no read/edit toggle label')
    check(!/mode === 'edit'|modeRef/.test(PAGE), 'the page editor no longer branches on a read or edit mode')
    check(!/setMode/.test(PAGE), 'the page editor has no edit-mode state setter')
    check(!/readOnly/.test(PAGE), 'the page editor does not build a read-only canvas')
    check(!/\bediting\b/.test(PAGE), 'the page editor never asks the frame for a mode')
    check(PAGE.includes('host.savePage'), 'a canvas change is saved through the host')
    check(/signatureRef\.current = JSON\.stringify/.test(PAGE), 'the save is scheduled from the ELEMENTS (a pan alone does not write)')
    check(PAGE.includes('setTimeout') && /clearTimeout/.test(PAGE), 'the save is debounced, so a drag is written once')
    check(/iframeRef\.current\?\.focus\(\)|focusFrame\(\)/.test(PAGE), 'the frame is focused after load, so the first drag reaches the canvas')
    check(/savePage[\s\S]{0,400}op: 'save'|op: 'save'[\s\S]{0,200}savePage/.test(HOST) || HOST.includes("op: 'save'"), 'the host saves with the command op "save"')
    check(COMMAND.includes("case 'save'"), 'the command handler serves op "save"')
    check(/readPage\(designmapDir, op\.page\)[\s\S]{0,600}writePage\(designmapDir, op\.page, next\)/.test(COMMAND), 'save re-reads the page, then writes the scene to the same file')

    // The behaviour behind "the first drag is saved and survives a reload": the panel's save
    // payload goes through the same command, and a fresh read shows the moved node.
    const { dir } = tempDesignmap()
    const tools = await toolSurface(dir)
    const command = await commandHandler(dir)
    await tools.call('map_edit', { page: 'drag', op: 'page.create' })
    const added = await tools.call('map_edit', { page: 'drag', op: 'node.add', label: 'Box', x: 40, y: 40 })
    const opened = await command({ op: 'page', page: 'drag' })
    equal(opened.kind, 'success', 'the panel reads the page through the command')
    const scene = JSON.parse(opened.text).scene
    const before = pageFile(dir, 'drag').elements.find((entry) => entry.id === added.id)
    const moved = scene.elements.map((entry) => (entry.id === added.id ? { ...entry, x: entry.x + 120, y: entry.y + 60 } : entry))
    const saved = await command({ op: 'save', page: 'drag', scene: { elements: moved, appState: scene.appState, files: scene.files ?? {} } })
    log('save', String(saved.text).slice(0, 200))
    equal(saved.kind, 'success', 'a dragged scene saves through the command')
    const after = pageFile(dir, 'drag').elements.find((entry) => entry.id === added.id)
    check(after.x === before.x + 120 && after.y === before.y + 60, `the page file holds the drag (${before.x},${before.y} -> ${after.x},${after.y})`)
    const reopened = await command({ op: 'page', page: 'drag' })
    const reloaded = JSON.parse(reopened.text).scene.elements.find((entry) => entry.id === added.id)
    check(reloaded.x === after.x && reloaded.y === after.y, 'a reload reads the moved node back from the page file')
    return
  }

  throw new Error(`unknown case ${CASE}`)
})
