// Loaded in <head> so an expanded card is already expanded on first paint after a page change.
try {
  if (sessionStorage.getItem('expanded')) document.documentElement.classList.add('expanded');
} catch {
  // Storage can be blocked; the view then simply starts collapsed.
}
