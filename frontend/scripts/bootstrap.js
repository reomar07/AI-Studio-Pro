
    tailwind.config = { darkMode: 'class' }

// Keep feature code separate from the original chat controller.
(function () {
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = 'frontend/styles/themes.css';
  document.head.appendChild(css);
  for (const file of ['appearance.js', 'context_menu.js']) {
    const script = document.createElement('script');
    script.src = 'frontend/scripts/' + file;
    script.async = false;
    document.head.appendChild(script);
  }
})();
