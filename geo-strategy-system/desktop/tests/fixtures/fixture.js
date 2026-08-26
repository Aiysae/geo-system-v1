void window.shituDesktop.getInfo().then(info => {
  document.querySelector("#runtime").textContent = `${info.name} ${info.version} ${info.platform}`
})
