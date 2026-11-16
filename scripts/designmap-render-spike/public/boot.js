/* Boot the spike on the REAL @deepseek-ai/dsh-client-modules module system.
 *
 * Mirrors the queue facade the DSH index installs before the shell
 * (dsh-client-modules lib/index.js → bootInjections): a pending queue, then
 * create() materializes the modules bundle and hands the page its module
 * system. The difference from the product page: this static page, not the
 * Vite shell, supplies the seed table (window.__SPIKE_SEED__) and the boot
 * graph row for the spike bundle.
 */
(() => {
  const script = document.currentScript
  const bundle = script.dataset.bundle
  const ID = '@spike/designmap-render'
  const boot = {
    rev: 'spike-1',
    release: { version: 'spike' },
    entries: [{ id: ID, url: `/plugins/${ID}/client.js?rev=spike-1`, rev: 'spike-1' }],
    batches: [{ phase: 'application', url: bundle, rev: 'spike-1', entries: [ID] }],
  }
  const show = (error) => {
    const detail = error && error.stack ? error.stack : String(error)
    window.__SPIKE_ERROR__ = detail
    const host = document.getElementById('boot-error')
    if (host !== null) {
      host.hidden = false
      host.textContent = detail
    }
    console.error(error)
  }
  try {
    const system = window.__ModuleLoader__.create({
      boot,
      staticModules: window.__SPIKE_SEED__,
    })
    window.__SPIKE_LOADER__ = system
    window.__SPIKE_READY__ = system
      .import(ID, '', {})
      .then((exports) => {
        window.__SPIKE_IMPORT_OK__ = true
        window.__SPIKE_EXPORTS__ = exports
      })
      .catch(show)
  } catch (error) {
    show(error)
  }
})()
