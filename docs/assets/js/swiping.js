/* --------------------------- Swiper Details --------------------------- */
const swiper = new Swiper(".swiperDetails", {
    slidesPerView: "auto",
    // centeredSlides: false,  //start without centering
    centeredSlides: true, //always centered
    spaceBetween: 17,
    speed: 400,

    // responsive breakpoints
    breakpoints: {
        // larger space between each slide for larger than mobile screen
        640: {
            spaceBetween: 30
        },

        1024: {
            spaceBetween: 50
        }
        
    },

    // elements
    pagination: {
        el: ".swiper-pagination",
        clickable: true,
    },

    navigation: {
        nextEl: ".swiper-button-next",
        prevEl: ".swiper-button-prev",
    },

    // listen for slide changes 
    on: {
        init: function() {
            // add class to wrapper when on first slide
            this.wrapperEl.classList.add('at-start');
        },
        slideChange: function() {
            if (this.activeIndex === 0) {
                this.wrapperEl.classList.add('at-start');
            } else {
                this.wrapperEl.classList.remove('at-start');
            }
        }
    }
});