/* VoltRide static site - vanilla JS */

// Theme toggle
document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.getElementById('themeToggle')
  if (!toggle) return
  toggle.addEventListener('click', function () {
    var html = document.documentElement
    var current = html.getAttribute('data-theme')
    var next = current === 'dark' ? 'light' : 'dark'
    html.setAttribute('data-theme', next)
    try { localStorage.setItem('theme', next) } catch (e) {}
  })
})

// Mobile nav toggle
(function () {
  var navToggle = document.getElementById('navToggle')
  var navLinks = document.getElementById('navLinks')
  if (!navToggle || !navLinks) return
  navToggle.addEventListener('click', function () {
    navLinks.classList.toggle('open')
  })
  var links = navLinks.querySelectorAll('a')
  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener('click', function () { navLinks.classList.remove('open') })
  }
})()
