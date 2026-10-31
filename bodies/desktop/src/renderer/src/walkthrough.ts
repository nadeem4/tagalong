/**
 * The walkthrough page's placeholder (built as `walkthrough.html`): prints the step it was
 * opened at. Replaced by the real steps in the next slice.
 */
const step = new URLSearchParams(window.location.search).get('step') ?? '1';
const root = document.getElementById('root');
if (root !== null) root.textContent = `Walkthrough step ${step}`;
