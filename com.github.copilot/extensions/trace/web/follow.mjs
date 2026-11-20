export function createFollow(checkbox, getPage) {
  let previousTop = getPage()?.scrollTop ?? 0;
  function onScroll() {
    const page = getPage();
    if (!page) return;
    const awayFromBottom = page.scrollHeight - page.clientHeight - page.scrollTop > 2;
    if (checkbox.checked && awayFromBottom && page.scrollTop < previousTop) checkbox.checked = false;
    previousTop = page.scrollTop;
  }
  function sync() {
    // A poll/resize may run before the browser dispatches the user's scroll event.
    onScroll();
    const page = getPage();
    if (checkbox.checked && page) {
      page.scrollTop = page.scrollHeight;
      previousTop = page.scrollTop;
    }
  }
  return {
    sync,
    onScroll,
    onChange() {
      previousTop = getPage()?.scrollTop ?? 0;
      sync();
    },
  };
}
