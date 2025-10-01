// ------------ VARIABLE SETUP -------------------------
// text
const daysRemainingEl = document.getElementById('days-remaining');
// countdown
const daysEl = document.getElementById('days');
const hoursEl = document.getElementById('hours');
const minutesEl = document.getElementById('minutes');
const secondsEl = document.getElementById('seconds');

// const targetDate = new Date("November 21 2025 00:00:00").getTime();
const targetDate = new Date("2025-11-21T14:00:00-08:00").getTime();

// ------------ FUNCTION -------------------------
function timer () {
    const currentTime= new Date().getTime();
    const distance = targetDate - currentTime;

    const days = Math.floor(distance/1000/60/60/24);
    const hours = Math.floor(distance/1000/60/60) % 24;
    const minutes = Math.floor(distance / 1000 / 60) % 60;
    const seconds = Math.floor(distance / 1000) % 60;

    // console.log(days + ":" + hours + ":" + minutes + ":" + hours + ":" + seconds);

    // update the website with numbers
    daysRemainingEl.innerHTML = days; 

    daysEl.innerHTML = days;
    hoursEl.innerHTML = hours;
    minutesEl.innerHTML = minutes;
    secondsEl.innerHTML = seconds;
}

// repeat function every second
setInterval(timer, 1000);