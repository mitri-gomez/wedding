// parallax effect for .hero-middle
const parallaxElements = document.querySelectorAll('.hero-middle');

function updateParallax() {
    parallaxElements.forEach(element => {
        const rect = element.getBoundingClientRect();
        
        // calculate background position to stay fixed relative to viewport
        const backgroundY = -rect.top;
        
        element.style.setProperty('--bg-y', `${backgroundY}px`);
    });
}

// requestAnimationFrame for smooth updates
let ticking = false;
function requestTick() {
    if (!ticking) {
        window.requestAnimationFrame(updateParallax);
        ticking = true;
        setTimeout(() => { ticking = false; }, 16);
    }
}

window.addEventListener('scroll', requestTick);
updateParallax(); // initial call