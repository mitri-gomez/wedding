/* -------- Transition navbar from transparent color theme to target theme (navbar-theme-info) -------- */
// transparent navbar element
const transparentNavEl = document.querySelector('.navbar-theme-transparent');

// scroll listener
if (transparentNavEl)
window.addEventListener('scroll', () => {
    // const currentScrollY = window.scrollY;

    // scrolling down add target theme--remove if scrolling up
    if (window.scrollY > 50) {
        transparentNavEl.classList.add('navbar-theme-info');
    } else {
        transparentNavEl.classList.remove('navbar-theme-info');
    }
});

/* -------- Close menu dropdown if clicking outside of menu -------- */
// wait for page to fully load
document.addEventListener('DOMContentLoaded', function() {

    // click listener to entire document
    document.addEventListener('click', function(event) {

        // navbar menu and toggler elements
        const menuEl = document.querySelector('#navbarMenu');
        const togglerEl = document.querySelector('.navbar-toggler');

        // if 1. menu exists, 2. menu is currently, and 3. click wasn't inside menu or toggler button
        // then close menu by clicking on toggler
        if (menuEl && menuEl.classList.contains('show') &&
            !menuEl.contains(event.target) &&
            !togglerEl.contains(event.target)) {
                togglerEl.click();
            }
    });
});
