/* --------------------------------------------------------- */
// Step Management System
/* --------------------------------------------------------- */
// configuration
GOOGLE_APPS_SCRIPT = 'https://script.google.com/macros/s/AKfycbzrhuo3Ld00__hVxEgboXcKNo6D9A416OTS3ePQW0iZzT4cw0yfO82-MWEt22LnV7qR/exec';

// define step paths
const stepOrder = {

    // single party routes
    attending: ['name', 'attendance', 'dietary', 'confirm', 'success'],
    notAttending: ['name', 'attendance', 'confirm', 'success'],

    // grp party routes
    attendingGrp: ['name', 'attendance-grp', 'dietary-grp', 'confirm', 'success'],        //checks at least one person in attendance
    notAttendingGrp: ['name', 'attendance-grp', 'confirm', 'success']                 //checks 'none' for attendance
};

// track current flow and position
let currentOrder = stepOrder.attendingGrp;      //current step sequence
let currentStepIndex = 0;   //current index
let guestVerified = false;  //track if guest is verified
let guestInfo = null;       //store guest info

// navigation controls
let navigating = false;

// grp dropdown dietary preferences options
const dietOptions = [
        ['none', 'None'],
        ['vegan', 'Vegan'],
        ['vegetarian', 'Vegetarian'],
        ['pescatarian', 'Pescatarian']
    ]

// ---- helpers---------------------
function isGroupParty() {
    return (guestInfo?.party?.party_type || 'single').toLowerCase() !== 'single';
}

function getSelectedGroupIds() {
    return Array.from(document.querySelectorAll('input[name="grpAttendees[]"]:checked'))
        .map(el => el.value)
        .filter(v => v !== 'none');
}

function idToNameMap() {
    return new Map((guestInfo?.members || []).map(m => [String(m.guest_id), `${m.first_name} ${m.last_name}`]));
}

function capitalize(s = '') {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// function isValidEmail(email) {
//     const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
//     return emailRegex.test(email);
// }

// ---- unified data model for both single + group ---------------------------------------------------------
const memberInfo = {};              // guest_id -> {guest_id, party_id, attending, dietary_pref}
let ogMemberInfo = {};            // copy taken right after verifyGuestName()

const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const deepClone = obj => JSON.parse(JSON.stringify(obj));

// function: create/refresh memberInfo from guestInfo (after verify)
function initMemberStateFromGuestInfo() {
    Object.keys(memberInfo).forEach(k => delete memberInfo[k]);

    const partyId = String(guestInfo?.guest?.party_id || '');
    const members = Array.isArray(guestInfo?.members) ? guestInfo.members : [];

    isGroup = isGroupParty(); // see if group

    // group party: fill everyone with default "no/none" and flip to "yes" as user selects
    if (isGroup) {
        members.forEach(m => {
            memberInfo[String(m.guest_id)] = {
                guest_id: String(m.guest_id),
                party_id: partyId,
                attending: 'no',
                dietary_pref: 'none'
            };
        });
    }

    // single party 
    if (!isGroup) {
        const g = guestInfo.guest;
        memberInfo[String(g.guest_id)] = {
            guest_id: String(g.guest_id),
            party_id: partyId || String(g.party_id || ''),
            attending: 'no',
            dietary_pref: 'none'
        };
    }

    ogMemberInfo = deepClone(memberInfo);
}

// function: attendance (single): update based on radio selection
function updateSinglePartyAttendance() {
    if (isGroupParty()) return; //only for single parties 

    const attending = document.querySelector('input[name="attendingInput"]:checked');
    const guestId = String(guestInfo?.guest?.guest_id || '');

    if (memberInfo[guestId] && attending) {
        memberInfo[guestId].attending = attending.value;

        // reset dietary to none if not attending
        if (attending.value === 'no') {
            memberInfo[guestId].dietary_pref = 'none';
        }

        console.log('Updated single party attendance:', guestId, attending.value);
    }
}

// function: update single party dietary preference based on radio selection 
function updateSinglePartyDietary() {
    if (isGroupParty()) return;  // only for single parties

    const dietary = document.querySelector('input[name="dietaryInput"]:checked');
    const guestId = String(guestInfo?.guest?.guest_id || '');

    if (memberInfo[guestId] && dietary) {
        memberInfo[guestId].dietary_pref = dietary.value;
        console.log('Updated single party dietary:', guestId, dietary.value);
    }
}

// function: attendance (group): reflect checkboxes into memberInfo
function syncMemberAttendanceFromChecklist() {
    const selectedIds = new Set(getSelectedGroupIds().map(String));
    Object.keys(memberInfo).forEach(id => {
        // if the group step exists, flip based on checklist
        if (document.getElementById('step-attendance-grp')) {
            memberInfo[id].attending = selectedIds.has(id) ? 'yes' : 'no';

            // if no longer attending, force dietary none
            if (memberInfo[id].attending === 'no') memberInfo[id].dietary_pref = 'none';
        }
    });

    // if change group dietary to 'yes', keep table in sync
    if (dietaryGrpState.answer === 'yes') {
        renderGrpDietaryTable([...selectedIds]);
    }
}

// function: when user switches group dietary to 'no', force all attending prefs to 'none'
function setAllDietaryNoneForAttendees() {
    // reset canonical state
    Object.values(memberInfo).forEach(m => {
        if (m.attending === 'yes') m.dietary_pref = 'none';
    });

    // reset ui mirror
    Object.keys(dietaryGrpState.perGuest).forEach(id => {
        dietaryGrpState.perGuest[id] = 'none';
    });
}

// function: build human friendly name map once
function getName(id) {
    const map = idToNameMap();
    return map.get(String(id)) || `Guest ${id}`;
}

// when user switches group dietary to No, force all attending prefs to none 

/* -------------------------------- Google Sheets API Functions ---------------------------------------------------------------------------------------------------------------------------------------- */

// function: verify guest name
async function verifyGuestName(firstName, lastName) {
    try {
        const body = new URLSearchParams({
            action: 'verifyGuest',
            firstName: firstName.trim(),
            lastName: lastName.trim()
        });

        const response = await fetch(GOOGLE_APPS_SCRIPT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body
        });

        if (!response.ok) {
            console.error('Apps script http error', response.status, await response.text());
            showAlertMessage('alert-name', "Unable to verify right now. Please try again.");
            // alert('Unable to verify guest at the moment. Please try again.');
            return false;
        }

        const result = await response.json();

        if (result.success && result.found) {
            // name found on guest list
            guestVerified = true;
            guestInfo = result;

            // initialize unified state now that we know party/guest ids
            initMemberStateFromGuestInfo();

            // decide step order (based on party of 1 or more)
            const partyType = (result.party?.party_type  || 'single').toLowerCase();
            if (partyType !== 'single') {

                // group of 2+
                currentOrder = stepOrder.attendingGrp;
                renderGrpChecklist(result.members);
            } else {
                // single party
                currentOrder = stepOrder.attending;
            }
            return true;
        } else {
            // name not found on guest list  
            guestVerified = false;
            guestInfo = null;
            // alert("Sorry, we couldn't find you on our guest list. Please check the spelling.");
            showAlertMessage('alert-name', "Please check your name's spelling");
            return false;
        }


        // return result;
    } catch (error) {
        console.error('Error verifying guest: ', error);
        guestVerified = false;
        guestInfo = null;
        showAlertMessage('alert-name', "Unable to verify right now. Please try again.");
        // alert('Unable to verify guest at moment. Please try again. Network Error: ' + error);
        return false;
        // return { found: false, error: 'Network error' };
    }
}

/*-------------------------- Functions: Navigation Spinner Utilities --------------------------*/
// 1) showButtonSpinner(button, loadingText=""): shows spinner with custom text
// 2) hideButtonSpinner(button): restores original button context
/*-----------------------------------------------------------------------------*/
function showButtonSpinner(button, loadingText = 'Loading...') {
    if (!button) return;

    // store original content
    button.setAttribute('data-original-html', button.innerHTML);

    // set spinner content
    button.innerHTML = `
        <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
        <span role="status">${loadingText}</span>
    `;

    // disable button
    button.disabled = true;
}

function hideButtonSpinner(button) {
    if (!button) return;

    // restore original content
    const originalHtml = button.getAttribute('data-original-html');
    if (originalHtml) {
        button.innerHTML = originalHtml;
        button.removeAttribute('data-original-html');
    }

    // enable button
    button.disabled = false;
}

/*-------------------------- Function: updateOrder() --------------------------*/
// Called when user chagnes their attendance choice
/*-----------------------------------------------------------------------------*/
function updateOrder() {
    const attending = document.querySelector('input[name="attendingInput"]:checked');

    // set up appropriate step order depending on attending answer
    if (attending && attending.value === 'yes') {
        currentOrder = stepOrder.attending;
    } else if (attending && attending.value === 'no') {
        currentOrder = stepOrder.notAttending;
    } // else let it stay at default
    // else {
    //     currentOrder = ['name', 'attendance', 'confirm']; // default until they choose
    // }
}

/*-------------------------- Function: showStep(stepIndex) --------------------------*/
// Controls which step is visible
/*-----------------------------------------------------------------------------*/
function showStep(stepIndex) {
    // hide all steps
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));

    // show current step
    const currentStepName = currentOrder[stepIndex];
    if (currentStepName) {
        document.getElementById(`step-${currentStepName}`).classList.add('active');
    }

    // update progress bar
    const progress = ((stepIndex + 1) / currentOrder.length) * 100;
    document.getElementById('progressBar').style.width = progress + '%';

    // update navigation buttons
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const submitBtn = document.getElementById('submitBtn');
    const buttonContainer = prevBtn.parentElement;  //get parent of nav buttons

    // hide back button on first step
    prevBtn.style.display = stepIndex === 0 ? 'none' : 'inline-block';

    // center button for first step only
    if (currentStepName === 'name') {
        buttonContainer.classList.remove('justify-content-between');
        buttonContainer.classList.add('justify-content-center');
    } else {
        buttonContainer.classList.remove('justify-content-center');
        buttonContainer.classList.add('justify-content-between');
    }

    // display buttons depending on step
    if (stepIndex === currentOrder.length - 2) {
        // for confirm step, hide next button and show submit button
        nextBtn.style.display = 'none';
        submitBtn.style.display = 'inline-block';
        updateSummary();
    } else if (stepIndex === currentOrder.length - 1) {
        // for success step, hide all navigation
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
        submitBtn.style.display = 'none';
        return;
    } else {
        nextBtn.style.display = 'inline-block';
        submitBtn.style.display = 'none';
    }

    // for attendance step, add user's first name
    const guestFirstName = guestInfo?.guest?.first_name || 'guest';
    if (currentStepName === 'attendance') {
        // const guestFirstName = guestInfo?.guest?.first_name || 'guest';
        const guestNameEl = document.getElementById('guest-name');
        guestNameEl.textContent = guestFirstName;
    }
    if (currentStepName === 'attendance-grp') {
        const guestNameGrpEl = document.getElementById('grp-guest-name');
        guestNameGrpEl.textContent = guestFirstName;
    }


    // lifecycle for dietary step
    if (currentStepName === 'dietary-grp') {
        enterDietaryGrpStep();
    }
}


/*-------------------------- Function: changeStep(direction) --------------------------*/
// Called when user clicks "Next" (+1) or "Back" (-1)
/*-----------------------------------------------------------------------------*/
async function changeStep(direction) {

    // ignore rentrancy
    if (navigating) return;
    navigating = true;

    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const submitBtn = document.getElementById('submitBtn');

    // disable nav buttons during async work
    [prevBtn, nextBtn, submitBtn].forEach(b => b && (b.disabled = true));

    try {
        // validate before moving forward
        if (direction === 1) {
            const currentStepName = currentOrder[currentStepIndex]

            // show spinner for next button during validation
            if (currentStepName === 'name') {
                hideAlertMessage('alert-name'); //hide alert message if there
                showButtonSpinner(nextBtn, 'Verifying...');
            }

            const ok = await validateCurrentStep();
            if (!ok) {

                // hide spinner if validation fails
                if (currentStepName === 'name') {
                    hideButtonSpinner(nextBtn);
                }

                return;   //stop here if invalid

            }

            // hide spinner after successful validation
            if (currentStepName === 'name') {
                hideButtonSpinner(nextBtn);
            }
                
            
            // update step order, if they just answered attendance
            if (currentStepName === 'attendance') {
                updateOrder();
            }
        }

        // move to the next/previous step
        currentStepIndex += direction;

        // boundary checks: don't go below 0 or above max steps
        if (currentStepIndex < 0) currentStepIndex = 0;
        if (currentStepIndex >= currentOrder.length) currentStepIndex = currentOrder.length - 1;

        // display the new step
        showStep(currentStepIndex);

    } finally {
        navigating = false;
        //re-enable buttons appropriate for the new step
        [prevBtn, nextBtn, submitBtn].forEach(b => b && (b.disabled = false));
    }

    // // validate current step before moving forward
    // if (direction === 1 && !await validateCurrentStep()) {
    //     return;
    // }

    // // update step order, if they just answered attendance
    // if (currentOrder[currentStepIndex] === 'attendance' && direction === 1) {
    //     updateOrder();
    // }

    // // move to the next/previous step
    // currentStepIndex += direction;

    // // boundary checks: don't go below 0 or above max steps
    // if (currentStepIndex < 0) currentStepIndex = 0;
    // if (currentStepIndex >= currentOrder.length) currentStepIndex = currentOrder.length - 1;

    // // display the new step
    // showStep(currentStepIndex);


}


/*-------------------------- Function: validateCurrentStep() --------------------------*/
// Checks if required fields have been filled out before moving on
/*-----------------------------------------------------------------------------*/
async function validateCurrentStep() {
    const currentStepName = currentOrder[currentStepIndex];
    const step = document.getElementById(`step-${currentStepName}`);
    const inputs = step.querySelectorAll('input[required]');
    let isValid = true;

    // check each required input
    for (let input of inputs) {
        if (input.type === 'radio') {

            // for radio buttons, check if any in the group is selected
            const radioGroup = step.querySelectorAll(`input[name="${input.name}"]`);
            const wrapper = step.querySelector('.validation-wrapper');
            const isChecked = Array.from(radioGroup).some(radio => radio.checked);

            if(!isChecked) {
                wrapper.classList.add('show-invalid');
                // add invalid class to all radio buttons
                // radioGroup.forEach(radio => {
                //     radio.classList.add('is-invalid');
                // });
                isValid = false;
            } else {
                // remove invalid class
                wrapper.classList.remove('was-validated');
                // radioGroup.forEach(radio => {
                //     radio.classList.remove('is-invalid');
                // });
            }

        } 

        if (input.type === 'checkbox') {
            // handled elsewhere (group step)
            continue;
        }

        // text/email/etc: require value AND browser validity
        const ok = input.value.trim() && input.checkValidity();
        input.classList.toggle('is-invalid', !ok);
        if (!ok) isValid = false;
    
    }


    // special validation for name step (verifying if on guest list)
    if (currentStepName === 'name' && isValid) {
        const firstName = document.getElementById('firstName').value.trim();
        const lastName = document.getElementById('lastName').value.trim();

        const verified = await verifyGuestName(firstName, lastName);
        if (!verified) {
            isValid = false;
        }
    }

    // validate email input (uses validator js library)
    if (currentStepName === 'name') {
        // get email input
        const emailInput = document.getElementById('userEmail');
        const email = emailInput.value.trim().toLowerCase();

        // reject common typo patterns
        const typoPatterns = [
            /\.ocm$/i,
            /\.cmo$/i,
            /\.con$/i,
            /\.cm$/i,
            /\.om$/i,
            /\.comm$/i,
            /\.ccom$/i,
            /\.co$/i,       //single .co without country
            /\.ne$/i,
            /\.nte$/i
        ];

        const validatorOptions = {
            require_tld: true,
            domain_specific_validation: true,    //extra gmail/provider validation
            host_blacklist: typoPatterns         //block typo patterns
        };

        if (email && !validator.isEmail(email, validatorOptions)) {
            emailInput.classList.add('is-invalid');
            isValid = false;
        }

    }


    // require at least one checkbox for grp attendance step
    if (currentStepName === 'attendance-grp') {
        const selected = Array.from(document.querySelectorAll('input[name="grpAttendees[]"]:checked'));  //all checked boxes (including none)
        const noneChecked = selected.some(checked => checked.value === 'none');
        const step = document.getElementById('step-attendance-grp');
        const wrapper = step.querySelector('.validation-wrapper');
        // const msg = step.querySelector('.invalid-feedback');

        // valid if none is checked or if at least one member is checked
        const ok = noneChecked || selected.length > 0;
        if (!ok) {
            wrapper.classList.add('show-invalid');
            isValid = false;
        } else {
            wrapper.classList.remove('show-invalid');
        }
        // if (msg) msg.style.display = ok ? 'none' : 'block';
        // if (!ok) return false;
    }

    // for group dietary preference, if checked "yes" then need to not have "None" for each party member
    if (currentStepName === 'dietary-grp') {
        if (dietaryGrpState.answer === 'yes') {
            // selected attendees
            const ids = getSelectedGroupIds();

            // must have at least one preference that isn't 'none'
            const hasRealPref = ids.some(id => (dietaryGrpState.perGuest[id] || 'none') !== 'none');
            if (!hasRealPref) {
                showDietaryGrpError('Please choose at least one dietary preference (other than "None")')
                return false;
            }

            // clear any prior erro if "no" or valid "yes"
            showDietaryGrpError('');
        }
    }

    return isValid; //all validation passed
}

/*-------------------------- Function: renderGrpChecklist() --------------------------*/
// For grp attendance, render checklist (create checkboxes of grp members)
/*-----------------------------------------------------------------------------*/
function renderGrpChecklist(members = []) {
    const container = document.getElementById('grpChecklist');
    container.innerHTML = '';  //clear old content

    // if no members info
    if (!Array.isArray(members) || members.length === 0) {
        container.innerHTML = '<p class="text-danger">No party members found.</p>';
        return;
    }

    // create list group structure
    const ul = document.createElement('ul');
    ul.className = 'list-group list-group-cards';

    // get each member info for checklist
    members.forEach(m => {
        const member_id = `guest_${m.guest_id}`;
        const li = document.createElement('li');
        li.className = 'list-group-item';

        li.innerHTML = `
            <input class="form-check-input grp-member me-3" type="checkbox" id="${member_id}" name="grpAttendees[]" value="${m.guest_id}">
            <label class="form-check-label stretched-link" for="${member_id}">
                ${m.first_name} ${m.last_name}
            </label>
        `;
        ul.appendChild(li);
    });

    // "none" check option
    const noneLi = document.createElement('li');
    noneLi.className = 'list-group-item none-option';
    noneLi.innerHTML = `
        <input class="form-check-input me-3" type="checkbox" id="grpNone" name="grpAttendees[]" value="none">
        <label class="form-check-label stretched-link" for="grpNone">None</label>
    `;

    ul.appendChild(noneLi);

    // invalid feedback div after list
    const invalidFeedback = document.createElement('div');
    invalidFeedback.className = 'invalid-feedback';
    invalidFeedback.textContent = 'Please select at least one guest (or "None")';

    // clear container and add list + feedback
    container.appendChild(ul);
    container.appendChild(invalidFeedback);

    // if "none" checked then uncheck other options; if any member checked then uncheck "none"
    const noneBox = document.getElementById('grpNone');
    const memberBoxes = document.querySelectorAll('.grp-member');

    function updateOrderGrp() {    //function: update group order based on checking none
        const anyMember = Array.from(memberBoxes).some(box => box.checked);
        if (noneBox.checked && anyMember) {
            noneBox.checked = false;
        }

        // update step order--> if "none" checked then notAttendingGrp otherwise attendingGrp
        currentOrder = noneBox.checked
            ? stepOrder.notAttendingGrp
            : stepOrder.attendingGrp;

    }

    // event listeners 
    noneBox.addEventListener('change', () => {
        // uncheck member boxes if none checked
        if (noneBox.checked) memberBoxes.forEach(box => (box.checked = false));
        updateOrderGrp();
    });

    memberBoxes.forEach(box => box.addEventListener('change', () => {
        // uncheck None if any member box is checked
        if (Array.from(memberBoxes).some(member => member.checked)) noneBox.checked = false;
        updateOrderGrp();
    }));

    // initialize order (default to notAttendingGrp)
    updateOrderGrp();

    // keep memberInfo in sync as checklist changes
    function onChecklistChange() {
        syncMemberAttendanceFromChecklist();
    }
    noneBox.addEventListener('change', onChecklistChange);
    memberBoxes.forEach(box => box.addEventListener('change', onChecklistChange));

    // initial sync
    syncMemberAttendanceFromChecklist();
}

/*-------------------------- Functions: Render Grp Dietary Table --------------------------*/
// 1) renderGrpDietaryTable(): builds the per person dietary table
// 2) setupDietaryGrpUI(): one-time wiring for the Yes/No radios
// 3) enterDietaryGrpStep(): lifecycle when entering the dietary-grp step
// 4) showDietaryGrpError(): show/hide error message under table
/*-----------------------------------------------------------------------------*/
// persis group dietary UI between navigations
const dietaryGrpState = {
    answer: null,               // 'yes' | 'no' | null
    perGuest: {}                // { [guestId]: 'vegan' | 'vegetarian' | 'pescatarian' | 'none' }
}

function renderGrpDietaryTable(selectedIds) {
    const wrap = document.getElementById('grp-dietary-table-wrap');
    const tbody = document.querySelector('#grp-dietary-table tbody');
    tbody.innerHTML = '';  //clear old content
    
    // set up input values (selected party members 'First Last')
    const map = idToNameMap();
    // const options = [
    //     ['none', 'None'],
    //     ['vegan', 'Vegan'],
    //     ['vegetarian', 'Vegetarian'],
    //     ['pescatarian', 'Pescatarian']
    // ]

    // keep only entries for currently selected guests
    Object.keys(dietaryGrpState.perGuest).forEach(id => {
        if (!selectedIds.includes(id)) delete dietaryGrpState.perGuest[id];
    });

    // build table row for each selected attendee
    selectedIds.forEach(id => {

        // // default to 'none' if this if newly selected guest
        // if (!dietaryGrpState.perGuest[id]) dietaryGrpState.perGuest[id] = 'none';

        const tr = document.createElement('tr');

        // left cell: name
        const name = map.get(String(id)) || id;
        tr.innerHTML = `<td>${name}</td>`;
        
        // right cell: <select> with options (default is none)
        const td = document.createElement('td');
        const selectId = `diet_${id}`;
        const select = document.createElement('select');
        select.className = 'form-select form-select-sm grp-diet-select';
        select.id = selectId;
        select.name = selectId;

        // ensure a member record
        if (!memberInfo[id]) {
            memberInfo[id] = {
                guest_id: String(id),
                party_id: String(guestInfo?.party?.party_id || ''),
                attending: 'yes',
                dietary_pref: 'none'
            };
        }

        // default perGueset from memberInfo if missing
        if (!dietaryGrpState.perGuest[id]) {
            dietaryGrpState.perGuest[id] = memberInfo[id].dietary_pref || 'none';
        }

        // options
        dietOptions.forEach(([val, label]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            if (val === 'none') opt.selected = true;  //default
            select.appendChild(opt);
        });

        // restore saved value
        select.value = memberInfo[id].dietary_pref || dietaryGrpState.perGuest[id] || 'none';

        // write through to both states
        select.addEventListener('change', () => {
            const v = select.value || 'none';
            dietaryGrpState.perGuest[id] = v;
            memberInfo[id].dietary_pref = v;
        });

        td.appendChild(select);
        tr.appendChild(td);
        tbody.appendChild(tr);
    });

    // show table only if there are attendees
    wrap.style.display = selectedIds.length ? 'block' : 'none';
}

let dietaryGrpWired = false;
function setupDietaryGrpUI() {
    if (dietaryGrpWired) return;
    dietaryGrpWired = true;

    const yes = document.getElementById('dietaryGrpYes');
    const no = document.getElementById('dietaryGrpNo');
    const wrap = document.getElementById('grp-dietary-table-wrap');

    // hide any validation message from previous try
    const hideMsg = () => {
        const msg = document.querySelector('#step-dietary-grp .invalid-feedback');
        if (msg) msg.style.display = 'none';
    };

    if (yes) {
        // open table when user picks yes
        yes.addEventListener('change', () => {
            hideMsg();
            dietaryGrpState.answer = yes.checked ? 'yes' : dietaryGrpState.answer;
            showDietaryGrpError('');  //clear any previous error
            renderGrpDietaryTable(getSelectedGroupIds());
            wrap.style.display = 'block';
        });
    } 
    if (no) {
        // open table when user picks no
        no.addEventListener('change', () => {
            hideMsg();
            dietaryGrpState.answer = no.checked ? 'no' : dietaryGrpState.answer;
            showDietaryGrpError('');  //clear any previous error
            setAllDietaryNoneForAttendees();  //force 'none' for dietary options
            wrap.style.display = 'none';
        });
    }

    // if attendee checkboxes change WHILE on this step and Yes is selected, refresh table so rows match attendees
    const refreshIfNeeded = () => {
        const onThisStep = document.getElementById('step-dietary-grp')?.classList.contains('active');
        if (onThisStep && dietaryGrpState.answer === 'yes') {
            renderGrpDietaryTable(getSelectedGroupIds());
        }
    };
    document.getElementById('grpChecklist')?.addEventListener('change', refreshIfNeeded);
}

function enterDietaryGrpStep() {
    setupDietaryGrpUI();

    const yes = document.getElementById('dietaryGrpYes');
    const no = document.getElementById('dietaryGrpNo');
    const wrap = document.getElementById('grp-dietary-table-wrap');
    
    // restore radios from state
    if (dietaryGrpState.answer === 'yes') {
        if (yes) yes.checked = true;
        if (no) no.checked = false;
        renderGrpDietaryTable(getSelectedGroupIds());
        if (wrap) wrap.style.display = 'block';
    } else if (dietaryGrpState.answer === 'no') {
        if (yes) yes.checked = false;
        if (no) no.checked = true;
        if (wrap) wrap.style.display = 'none';
    } else {
        // first time here, keep both unchecked and table hidden
        if (yes) yes.checked = false;
        if (no) no.checked = false;
        if (wrap) wrap.style.display = 'none';
    }
}

function showDietaryGrpError(text) {
    const wrap = document.getElementById('grp-dietary-table-wrap');
    if (!wrap) return;

    // reuse/create a message element
    let msg = document.getElementById('dietary-grp-extra-msg');
    if (!msg) {
        msg = document.createElement('div');
        msg.id = 'dietary-grp-extra-msg';
        msg.className = 'invalid-feedback d-block';
        wrap.appendChild(msg);
    }

    msg.textContent = text || '';
    msg.style.display = text ? 'block' : 'none';
}

/*-------------------------- Function: updateSummary() --------------------------*/
// Fills in the confirmation page with user's choices
/*-----------------------------------------------------------------------------*/
function updateSummary() {
    // common fields
    // const firstName = document.getElementById('firstName').value;
    // const lastName = document.getElementById('lastName').value;
    const userEmail = document.getElementById('userEmail').value;
    const attendingSummaryBlock = document.getElementById('attendingSummary');  //show only if attending
    const isGroup = isGroupParty();

    // update user name in summary
    // document.getElementById('summaryName').textContent = `${firstName} ${lastName}`;

    // update email in summary
    document.getElementById('summaryEmail').textContent = userEmail.trim().toLowerCase();
    // const attending = document.querySelector('input[name="attendingInput"]:checked');

    // ----- summary if single----------------
    if (!isGroup) {
        // single attending input
        const attending = document.querySelector('input[name="attendingInput"]:checked');
        
        // safety: if not attending (don't include attending summary block)
        if (!attending) {
            document.getElementById('summaryAttending').textContent = '';
            attendingSummaryBlock.style.display = 'none';
            return;
        }

        // update attending summary text with label from attending question
        const attendingLabel = document.querySelector(`label[for="${attending.id}"]`)?.textContent?.trim() || attending.value;
        document.getElementById('summaryAttending').textContent = attendingLabel;
    
        // if attending, show single dietary choice
        if (attending.value === 'yes') {
            // dietary input
            const dietarySelected = document.querySelector('input[name="dietaryInput"]:checked');
            const dietaryLabel = dietarySelected ? document.querySelector(`label[for="${dietarySelected.id}"]`)?.textContent?.trim() : '';
            document.getElementById('summaryDietary').textContent = dietaryLabel || '';

            // display attending summary block and hide group dietary table
            document.getElementById('summary-dietary-table-wrap').style.display = 'none';
            attendingSummaryBlock.style.display = 'block';
        } else {
            // not attending so hide dietary summary
            attendingSummaryBlock.style.display = 'none';
        }

        return; // done for single flow

    } 
    // else {
    //     // summary if group party
    //     const selected = Array.from(document.querySelectorAll('input[name="grpAttendees[]"]:checked'));
    //     const none = selected.some(box => box.value === 'none');

    //     // show attendingSummary (with dietary preference) only if attending
    //     if (none || selected.length === 0) {
    //         document.getElementById('summaryAttending').textContent = 'None';
    //         attendingSummary.style.display = 'none';   //hide
    //     } else {
    //         // show attending names
    //         const map = new Map((guestInfo?.members || []).map(m => [String(m.guest_id), `${m.first_name} ${m.last_name}`]));
    //         const names = selected.map(box => map.get(String(box.value)) || box.value);
    //         document.getElementById('summaryAttending').textContent = names.join(', ');

    //         // show dietary input
    //         const dietary = document.querySelector('input[name="dietaryInput"]:checked');
    //         const dietaryLabel = document.querySelector(`label[for="${dietary.id}"]`).textContent;
    //         document.getElementById('summaryDietary').textContent = dietaryLabel;

    //         // display
    //         attendingSummary.style.display = 'block';
    //     }
    // }

    // ----- summary if group ----------------
    // selected attendees (ids only and excludes none) --> use memberInfo as source of truth
    // const selectedIds = getSelectedGroupIds();
    const attendingIds = Object.values(memberInfo)
        .filter(m => m.attending === 'yes')
        .map(m => m.guest_id);

    // if none selected, show "none" and hide dietary info
    if (attendingIds.length === 0) {
        document.getElementById('summaryAttending').textContent = 'None';
        attendingSummaryBlock.style.display = 'none';

        // hide dietary table
        document.getElementById('summary-dietary-table-wrap').style.display = 'none';
        return;
    }

    // build a "attending" comma list of names
    const map = idToNameMap();
    const names = attendingIds.map(id => map.get(String(id)) || id);
    document.getElementById('summaryAttending').textContent = names.join(', ');

    // // determine group dietary yes or no (no--> treat everyone as none; yes--> only call it yes if at least one member is not none)
    // const groupAnswer = dietaryGrpState.answer;  //yes, no, null
    // const hasAnyRealPref = selectedIds.some(id => (dietaryGrpState.perGuest[id] || 'none') !== 'none');

    // // decide the ditary preference: 'yes/no' for group summary
    // const groupDietIsYes = groupAnswer === 'yes' && hasAnyRealPref;

    // // update text summary line for dietary
    // document.getElementById('summaryDietary').textContent = groupDietIsYes ? 'Yes' : 'No';

    // group dietary: yes if any attendee has a non 'none' preference
    const hasAnyRealPref = attendingIds.some(
        id => (memberInfo[id]?.dietary_pref || 'none') !== 'none'
    );
    document.getElementById('summaryDietary').textContent = hasAnyRealPref ? 'Yes' : 'No';

    // if 'yes' --> render a compact summary table with only the none 'none' rows
    const summaryWrap = document.getElementById('summary-dietary-table-wrap');
    const summaryTbody = document.querySelector('#summary-dietary-table tbody');
    summaryTbody.innerHTML = '';

    if (hasAnyRealPref) {
        attendingIds.forEach(id => {
            const pref = memberInfo[id]?.dietary_pref || 'none';
            if (pref !== 'none') {
                const tr = document.createElement('tr');
                const name = map.get(String(id)) || id;
                tr.innerHTML = `<td>${name}</td><td>${capitalize(pref)}</td>`;
                summaryTbody.appendChild(tr);
            }
        });
        summaryWrap.style.display = 'block'; //display table
    } else {
        summaryWrap.style.display = 'none'; //hide table if everyone is 'none'
    }

    // show the general attending block (for grp who are attending)
    attendingSummaryBlock.style.display = 'block';
    return;
}

/*-----------------------------------------------------------------------------*/
// Form Submission Handler
/*-----------------------------------------------------------------------------*/
document.getElementById('rsvpForm').addEventListener('submit', async function (e) {

    // always prevent default form submission
    e.preventDefault();

    // prevent incomplete/invalid form submissions (treat "enter" as "next" and validate last step)
    if (currentStepIndex !== currentOrder.length - 2) {
        // treat submit as "next" (if not final step)
        // e.preventDefault();
        await changeStep(1);
        return;
    } 

    // on confirm step, validate current step before 'submit'
    // e.preventDefault();
    const ok = await validateCurrentStep();
    if (!ok) return;

    // hide alert message if shown
    hideAlertMessage('alert-submit');

    // disable submit btn to prevent double submission and show loading
    const submitBtn = document.getElementById('submitBtn');
    showButtonSpinner(submitBtn, 'Sending...');


    try {
        // debugging (before building form data)
        console.log('=== MEMBERINFO DEBUG BEFORE SUBMISSION ===');
        console.log('isGroupParty():', isGroupParty());
        console.log('guestInfo:', guestInfo);
        console.log('memberInfo contents:');
        Object.keys(memberInfo).forEach(id => {
            console.log(`  ${id}:`, memberInfo[id]);
        });

        // Check what checkboxes are actually selected
        const checkboxes = document.querySelectorAll('input[name="grpAttendees[]"]:checked');
        console.log('Selected checkboxes:', Array.from(checkboxes).map(cb => `${cb.id}=${cb.value}`));

        //----------- build submission data ------------
        const formData = new URLSearchParams();
        formData.append('action', 'submitRSVP');
        formData.append('verified_guest_id', String(guestInfo?.guest?.guest_id || ''));
        formData.append('party_id', String(guestInfo?.guest?.party_id || ''));
        formData.append('email', document.getElementById('userEmail').value.trim().toLowerCase());
        
        // send all guest data (both attending and not attending)
        Object.values(memberInfo).forEach(member => {
            formData.append('guests[]', JSON.stringify({
                guest_id: String(member.guest_id),
                attending: member.attending,
                dietary_pref: member.dietary_pref || 'none'
            }));
        });

        // debug check
        console.log('FormData guests[] entries:', formData.getAll('guests[]'));

        // send to google apps script
        const response = await fetch(GOOGLE_APPS_SCRIPT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData
        });

        if (!response.ok) {
            throw new Error (`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        if (result.success) {
            currentStepIndex = currentOrder.length - 1;
            showStep(currentStepIndex);
        } else {
            throw new Error(result.message || 'Submission failed');
        }
    } catch (error) {
        console.error('Submission error:', error);
        showAlertMessage('alert-submit', "Please try to submit again or contact us directly.");
        // alert('Sorry, there was an error submitting your RSVP. Please try again or contact us directly.');
    } finally {
        // hide spiner and restore submit button
        hideButtonSpinner(submitBtn);
    }

});

/*-----------------------------------------------------------------------------*/
// Alert fucntions
// 1) takes alert id and message to be displayed (strings)
// 2) takes alert id and hides it
/*-----------------------------------------------------------------------------*/
function showAlertMessage(alertId, message) {
    let alertIdEl = document.getElementById(alertId);
    let messageEl = document.getElementById(`${alertId}-message`);

    // create alert message element
    messageEl.innerHTML = message;

    // display
    alertIdEl.style.display = 'block';
}

function hideAlertMessage(alertId) {
    let alertIdEl = document.getElementById(alertId);
    
    // hide if alert is shown
    if (alertIdEl) {
        alertIdEl.style.display = 'none';
    }
}
/*-----------------------------------------------------------------------------*/
// Event Listeners
/*-----------------------------------------------------------------------------*/
// listen for attendance changes to update steps order and member info
document.querySelectorAll('input[name="attendingInput"]').forEach(radio => {
    radio.addEventListener('change', function() {
        updateOrder();
        updateSinglePartyAttendance();
    });
});

// listen for single party dietary changes
document.querySelectorAll('input[name="dietaryInput"]').forEach(radio => {
    radio.addEventListener('change', function() {
        updateSinglePartyDietary();
    });
});

// clear guest verification when name field change
document.getElementById('firstName').addEventListener('input', function() {
    guestVerified = false;
    guestInfo = null;
});
document.getElementById('lastName').addEventListener('input', function() {
    guestVerified = false;
    guestInfo = null;
});

// clear invalid state for email input once user types valid email
document.getElementById('userEmail').addEventListener('input', (e) => {
    const el = e.target;
    if (el.value && el.checkValidity()) el.classList.remove('is-invalid');
});

// clear name alert when user starts typeing in either name field
document.getElementById('firstName').addEventListener('input', function() {
    guestVerified = false;
    guestInfo = null;
    hideAlertMessage('alert-name');
});
document.getElementById('lastName').addEventListener('input', function() {
    guestVerified = false;
    guestInfo = null;
    hideAlertMessage('alert-name');
});

// clear "show invalid" from radio and checkboxes once user selects option
document.addEventListener('change', function(e) {
    const input = e.target;

    // radio buttons
    if (input.type === 'radio') {
        const wrapper = input.closest('.validation-wrapper');
        if (wrapper) {
            wrapper.classList.remove('show-invalid');
        }
    }

    // checkboxes (grp attendance)
    if (input.type === 'checkbox' && input.name === 'grpAttendees[]') {
        const wrapper = document.getElementById('grpChecklist');
        if (wrapper) {
            wrapper.classList.remove('show-invalid');
        }
    }
});

/*-----------------------------------------------------------------------------*/
// Initialization
/*-----------------------------------------------------------------------------*/
// initialize
document.addEventListener('DOMContentLoaded', function() {
    currentOrder = stepOrder.attendingGrp;  // default to group flow
    currentStepIndex = 0;
    showStep(0); //show the first step
});
