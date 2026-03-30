// schedule.js
// Global state
let currentJob = null;
let currentDate = null;
let dateRangeStart = null;
let dateRangeEnd = null;
let isDateRangeMode = false;
let dataEntryEmployee = null;
let employees = [];
let subjobs = [];
let schedules = [];
let editingRows = new Set();
let rawHoursCache = {};
let rowIdMap = new Map();
let recentScheduleCache = {};

function generateTempId() {
    return 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function updateURLFromState() {
    const params = new URLSearchParams();
    
    if (currentJob) {
        params.set('job_id', currentJob.id);
        params.set('job_name', currentJob.name);
    }
    
    if (dataEntryEmployee) {
        params.set('employee_id', dataEntryEmployee.id);
        params.set('employee_name', dataEntryEmployee.name);
    }
    
    if (isDateRangeMode) {
        params.set('mode', 'range');
        if (dateRangeStart) params.set('start_date', dateRangeStart);
        if (dateRangeEnd) params.set('end_date', dateRangeEnd);
    } else if (currentDate) {
        params.set('date', currentDate);
    }
    
    const newURL = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newURL);
}

function initializeFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    
    const jobId = urlParams.get('job_id');
    const jobName = urlParams.get('job_name');
    const employeeId = urlParams.get('employee_id');
    const employeeName = urlParams.get('employee_name');
    const date = urlParams.get('date');
    const mode = urlParams.get('mode') || 'single';
    const startDate = urlParams.get('start_date');
    const endDate = urlParams.get('end_date');
    
    if (mode === 'range' && (startDate || endDate)) {
        const rangeRadio = document.querySelector('input[name="dateMode"][value="range"]');
        if (rangeRadio) rangeRadio.checked = true;
        isDateRangeMode = true;
        
        const singleContainer = document.getElementById('singleDateContainer');
        const rangeContainer = document.getElementById('dateRangeContainer');
        if (singleContainer) singleContainer.classList.add('hidden');
        if (rangeContainer) rangeContainer.classList.remove('hidden');
        
        if (startDate) {
            dateRangeStart = startDate;
            const startInput = document.getElementById('startDate');
            if (startInput) startInput.value = startDate;
        }
        if (endDate) {
            dateRangeEnd = endDate;
            const endInput = document.getElementById('endDate');
            if (endInput) endInput.value = endDate;
        }
    } else if (date) {
        currentDate = date;
        const workDate = document.getElementById('workDate');
        if (workDate) workDate.value = date;
    }
    
    if (employeeId && employeeName) {
        dataEntryEmployee = {id: parseInt(employeeId), name: employeeName};
        const searchInput = document.getElementById('dataEntryEmployeeSearch');
        if (searchInput) searchInput.value = employeeName;
        
        schedules.forEach((s) => {
            if (!s.schedule_id) {
                s.form_id = employeeId.toString();
            }
        });
    }
    
    if (jobId && jobName) {
        setTimeout(() => {
            selectJobFromURL(parseInt(jobId), jobName);
        }, 100);
    }
}

function selectJobFromURL(id, name) {
    currentJob = {id, name};
    
    const jobResults = document.getElementById('jobResults');
    const jobSearch = document.getElementById('jobSearch');
    if (jobResults) jobResults.style.display = 'none';
    if (jobSearch) jobSearch.value = name;
    
    fetch('/api/jobs/' + id + '/subjobs')
        .then(r => r.json())
        .then(data => {
            subjobs = data;
        })
        .catch(err => {
            console.error('Error loading subjobs:', err);
            showError('Failed to load subjobs');
        });
    
    fetch('/api/jobs/' + id + '/dates')
        .then(r => r.json())
        .then(dates => {
            const dropdown = document.getElementById('existingDates');
            if (dropdown) {
                dropdown.innerHTML = '<option value="">-- Existing Dates --</option>' + 
                    dates.map(d => `<option value="${d}">${d}</option>`).join('');
            }
            
            if (isDateRangeMode && dateRangeStart && dateRangeEnd) {
                loadDateRange();
            } else if (currentDate) {
                autoLoad();
            }
        })
        .catch(err => {
            console.error('Error loading dates:', err);
            showError('Failed to load dates');
        });
}

function showError(msg) {
    const el = document.getElementById('errorMsg');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 5000);
}

function showSuccess(msg) {
    const el = document.getElementById('successMsg');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 3000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeJsString(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function fetchRecentSchedule(employeeId, callback) {
    if (recentScheduleCache[employeeId]) {
        callback(recentScheduleCache[employeeId]);
        return;
    }
    
    fetch('/api/employees/' + employeeId + '/recent-schedule')
        .then(r => r.json())
        .then(data => {
            recentScheduleCache[employeeId] = data;
            callback(data);
        })
        .catch(err => {
            console.error('Error fetching recent schedule:', err);
            callback(null);
        });
}

function selectEmployee(rowId, id, name) {
    const s = schedules.find(sch => sch._rowId === rowId);
    if (!s) return;
    
    const employee = employees.find(e => e.id === id);
    if (!employee) return;
    
    s.employee_id = id;
    s.employee_name = name;
    
    const empSearch = document.getElementById(`empSearch${rowId}`);
    const empResults = document.getElementById(`empResults${rowId}`);
    
    if (empSearch) empSearch.value = name;
    if (empResults) empResults.style.display = 'none';
    
    delete s._suggested;
    
    fetchRecentSchedule(id, (recent) => {
        if (recent) {
            autofillFromRecentSchedule(rowId, recent);
            setTimeout(() => focusField(rowId, 'start_time'), 50);
        } else {
            s._suggested = {
                start_time: '07:00',
                end_time: '17:00',
                lunch: 0.5
            };
            render();
            setTimeout(() => focusField(rowId, 'subjob'), 50);
        }
    });
}

function autofillFromRecentSchedule(rowId, recent) {
    if (!recent) return;
    
    const s = schedules.find(sch => sch._rowId === rowId);
    if (!s) return;
    
    if (recent.subjob_id) {
        s.subjob_id = recent.subjob_id;
        s.subjob_name = recent.subjob_name;
    }
    
    s.qualified = recent.qualified || false;
    
    s._suggested = {
        start_time: recent.start_time || '07:00',
        end_time: recent.end_time || '17:00',
        lunch: recent.lunch !== null && recent.lunch !== undefined ? recent.lunch : 0.5,
        description: recent.description || ''
    };
    
    render();
}

function focusField(rowId, field) {
    let inputId = null;
    
    switch(field) {
        case 'subjob':
            inputId = `subjobSearch${rowId}`;
            setTimeout(() => showSubjobDropdown(rowId), 10);
            break;
        case 'qualified':
            const checkbox = document.querySelector(`#row${rowId} input[type="checkbox"]`);
            if (checkbox) checkbox.focus();
            return;
        case 'start_time':
            inputId = `startTimeInput${rowId}`;
            break;
        case 'end_time':
            inputId = `endTimeInput${rowId}`;
            break;
        case 'lunch':
            inputId = `lunchInput${rowId}`;
            break;
        case 'hours':
            inputId = `hoursInput${rowId}`;
            break;
        case 'ot_hours':
            inputId = `otInput${rowId}`;
            break;
        case 'description':
            inputId = `descInput${rowId}`;
            break;
        case 'save':
            highlightSaveButton(rowId);
            return;
    }
    
    if (inputId) {
        const input = document.getElementById(inputId);
        if (input) input.focus();
    }
}

function navigateFromField(rowId, currentField) {
    const fieldOrder = ['subjob', 'qualified', 'start_time', 'end_time', 'lunch', 'hours', 'ot_hours', 'description', 'save'];
    const currentIndex = fieldOrder.indexOf(currentField);
    if (currentIndex === -1 || currentIndex >= fieldOrder.length - 1) return;
    
    const nextField = fieldOrder[currentIndex + 1];
    const s = schedules.find(sch => sch._rowId === rowId);
    if (!s) return;
    
    switch(currentField) {
        case 'start_time':
            const startInput = document.getElementById(`startTimeInput${rowId}`);
            if (startInput && !startInput.value && s._suggested?.start_time) {
                applyTimeValue(rowId, 'start_time', s._suggested.start_time);
            }
            break;
        case 'end_time':
            const endInput = document.getElementById(`endTimeInput${rowId}`);
            if (endInput && !endInput.value && s._suggested?.end_time) {
                applyTimeValue(rowId, 'end_time', s._suggested.end_time);
            }
            break;
        case 'lunch':
            const lunchInput = document.getElementById(`lunchInput${rowId}`);
            if (lunchInput && !lunchInput.value && s._suggested?.lunch !== undefined) {
                s.lunch = s._suggested.lunch;
                lunchInput.value = s._suggested.lunch;
            }
            break;
        case 'hours':
            const hoursInput = document.getElementById(`hoursInput${rowId}`);
            const rawHours = getRawHours(rowId);
            if (hoursInput && !hoursInput.value && rawHours > 0) {
                applyHoursValue(rowId, rawHours);
            }
            break;
        case 'ot_hours':
            const otInput = document.getElementById(`otInput${rowId}`);
            const suggestedOT = s._suggestedOT || getSuggestedOT(rowId);
            if (otInput && !otInput.value && suggestedOT > 0) {
                applyOTValue(rowId, suggestedOT);
            }
            break;
    }
    
    setTimeout(() => focusField(rowId, nextField), 10);
}

function onSubjobKeyDown(rowId, e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        const s = schedules.find(sch => sch._rowId === rowId);
        if (s && s.subjob_id) {
            navigateFromField(rowId, 'subjob');
        }
    }
}

function onQualifiedKeyDown(rowId, e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        navigateFromField(rowId, 'qualified');
    }
}

function onTimeKeyDown(rowId, field, e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        const inputId = field === 'start_time' ? `startTimeInput${rowId}` : `endTimeInput${rowId}`;
        const input = document.getElementById(inputId);
        const s = schedules.find(sch => sch._rowId === rowId);
        
        if (input && !input.value && s?._suggested) {
            const suggestedTime = field === 'start_time' ? s._suggested.start_time : s._suggested.end_time;
            if (suggestedTime) {
                applyTimeValue(rowId, field, suggestedTime);
                return;
            }
        }
        
        navigateFromField(rowId, field);
    }
}

function onLunchKeyDown(rowId, e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        const input = document.getElementById(`lunchInput${rowId}`);
        const s = schedules.find(sch => sch._rowId === rowId);
        
        if (input && !input.value && s?._suggested?.lunch !== undefined) {
            s.lunch = s._suggested.lunch;
            input.value = s._suggested.lunch;
        }
        
        navigateFromField(rowId, 'lunch');
    }
}

function onHoursKeyDown(rowId, e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        const input = document.getElementById(`hoursInput${rowId}`);
        const rawHours = getRawHours(rowId);
        
        if (input && !input.value && rawHours > 0) {
            applyHoursValue(rowId, rawHours);
        }
        
        navigateFromField(rowId, 'hours');
    }
}

function onOTKeyDown(rowId, e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        const input = document.getElementById(`otInput${rowId}`);
        const s = schedules.find(sch => sch._rowId === rowId);
        const suggestedOT = s?._suggestedOT || getSuggestedOT(rowId);
        
        if (input && !input.value && suggestedOT > 0) {
            applyOTValue(rowId, suggestedOT);
        }
        
        navigateFromField(rowId, 'ot_hours');
    }
}

function onDescriptionKeyDown(rowId, e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        navigateFromField(rowId, 'description');
    }
}

function highlightSaveButton(rowId) {
    const btn = document.querySelector(`button[data-row-id="${rowId}"].btn-save-row`);
    if (btn) {
        btn.style.backgroundColor = '#28a745';
        btn.style.color = 'white';
        btn.style.transform = 'scale(1.1)';
        btn.focus();
        setTimeout(() => {
            btn.style.backgroundColor = '';
            btn.style.color = '';
            btn.style.transform = '';
        }, 2000);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    loadEmployees();
    setupEventListeners();
    setupStaticEnterKeyHandlers();
    setupEventDelegation();
    
    // Initialize from URL parameters if present
    initializeFromURL();
});

function initializeFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    
    const jobId = urlParams.get('job_id');
    const jobName = urlParams.get('job_name');
    const employeeId = urlParams.get('employee_id');
    const employeeName = urlParams.get('employee_name');
    const date = urlParams.get('date');
    const mode = urlParams.get('mode') || 'single';
    const startDate = urlParams.get('start_date');
    const endDate = urlParams.get('end_date');
    
    // Set date mode first
    if (mode === 'range' && (startDate || endDate)) {
        const rangeRadio = document.querySelector('input[name="dateMode"][value="range"]');
        if (rangeRadio) rangeRadio.checked = true;
        isDateRangeMode = true;
        
        // Hide single, show range
        const singleContainer = document.getElementById('singleDateContainer');
        const rangeContainer = document.getElementById('dateRangeContainer');
        if (singleContainer) singleContainer.classList.add('hidden');
        if (rangeContainer) rangeContainer.classList.remove('hidden');
        
        // Set range dates
        if (startDate) {
            dateRangeStart = startDate;
            const startInput = document.getElementById('startDate');
            if (startInput) startInput.value = startDate;
        }
        if (endDate) {
            dateRangeEnd = endDate;
            const endInput = document.getElementById('endDate');
            if (endInput) endInput.value = endDate;
        }
    } else if (date) {
        // Single date mode (default)
        currentDate = date;
        const workDate = document.getElementById('workDate');
        if (workDate) workDate.value = date;
    }
    
    // Set data entry employee (must be done before job to ensure form_id is set on new rows)
    if (employeeId && employeeName) {
        dataEntryEmployee = {id: parseInt(employeeId), name: employeeName};
        const searchInput = document.getElementById('dataEntryEmployeeSearch');
        if (searchInput) searchInput.value = employeeName;
        
        // Pre-set form_id on any rows that get created
        schedules.forEach((s) => {
            if (!s.schedule_id) {
                s.form_id = employeeId.toString();
            }
        });
    }
    
    // Set job (this triggers autoLoad which needs date already set)
    if (jobId && jobName) {
        // Small delay to ensure DOM is ready, then select job
        setTimeout(() => {
            selectJobFromURL(parseInt(jobId), jobName);
        }, 100);
    } else if (date || startDate) {
        // If only date provided without job, just load that mode
        if (isDateRangeMode && dateRangeStart && dateRangeEnd) {
            // Don't auto-load, wait for job selection
        } else if (currentDate) {
            // Don't auto-load, wait for job selection
        }
    }
}

function selectJobFromURL(id, name) {
    currentJob = {id, name};
    
    const jobResults = document.getElementById('jobResults');
    const jobSearch = document.getElementById('jobSearch');
    if (jobResults) jobResults.style.display = 'none';
    if (jobSearch) jobSearch.value = name;
    
    // Load subjobs and dates like regular selectJob
    fetch('/api/jobs/' + id + '/subjobs')
        .then(r => r.json())
        .then(data => {
            subjobs = data;
        })
        .catch(err => {
            console.error('Error loading subjobs:', err);
            showError('Failed to load subjobs');
        });
    
    fetch('/api/jobs/' + id + '/dates')
        .then(r => r.json())
        .then(dates => {
            const dropdown = document.getElementById('existingDates');
            if (dropdown) {
                dropdown.innerHTML = '<option value="">-- Existing Dates --</option>' + 
                    dates.map(d => `<option value="${d}">${d}</option>`).join('');
            }
            
            // Now auto-load schedules since we have job + date
            if (isDateRangeMode && dateRangeStart && dateRangeEnd) {
                loadDateRange();
            } else if (currentDate) {
                autoLoad();
            }
        })
        .catch(err => {
            console.error('Error loading dates:', err);
            showError('Failed to load dates');
        });
}

function loadEmployees() {
    fetch('/api/employees')
        .then(r => {
            if (!r.ok) throw new Error('Failed to load employees');
            return r.json();
        })
        .then(data => {
            employees = data;
        })
        .catch(err => {
            console.error('Error loading employees:', err);
            showError('Failed to load employees');
        });
}

function setupStaticEnterKeyHandlers() {
    setupEnterKeySearch('jobSearch', 'jobResults');
    setupEnterKeySearch('dataEntryEmployeeSearch', 'dataEntryEmployeeResults');
}


function setupEnterKeySearch(inputId, resultsId) {
    const input = document.getElementById(inputId);
    const results = document.getElementById(resultsId);
    if (!input || !results) return;
    
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const firstResult = results.querySelector('div');
            if (firstResult && results.style.display !== 'none') {
                firstResult.click();
            }
        }
    });
}

function setupDynamicEnterKeySearch(inputElement, resultsElement) {
    if (!inputElement) return;
    
    inputElement.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const firstResult = resultsElement.querySelector('div');
            if (firstResult && resultsElement.style.display !== 'none') {
                firstResult.click();
            }
        }
    });
}

function advancedFilterSearch(items, query, searchField = 'name') {
    if (!query || !items) return [];
    const q = query.toLowerCase().trim();
    const qStr = q.toString();
    
    const containing = items.filter(item => {
        const name = (item[searchField] || '').toLowerCase();
        const id = (item.id || '').toString();
        return name.includes(q) || id.includes(qStr);
    });
    
    containing.sort((a, b) => {
        const nameA = (a[searchField] || '').toLowerCase();
        const nameB = (b[searchField] || '').toLowerCase();
        const aStartsWith = nameA.startsWith(q);
        const bStartsWith = nameB.startsWith(q);
        if (aStartsWith && !bStartsWith) return -1;
        if (!aStartsWith && bStartsWith) return 1;
        return nameA.localeCompare(nameB);
    });
    
    return containing;
}

function setupEventDelegation() {
    document.addEventListener('click', function(e) {
        if (e.target.matches('.btn-edit') || e.target.closest('.btn-edit')) {
            const btn = e.target.matches('.btn-edit') ? e.target : e.target.closest('.btn-edit');
            const rowId = btn.dataset.rowId;
            if (rowId) enableEdit(rowId);
        }
        
        if (e.target.matches('.btn-save-row') || e.target.closest('.btn-save-row')) {
            const btn = e.target.matches('.btn-save-row') ? e.target : e.target.closest('.btn-save-row');
            const rowId = btn.dataset.rowId;
            if (rowId) saveSingleRow(rowId);
        }
        
        if (e.target.matches('.btn-delete') || e.target.closest('.btn-delete')) {
            const btn = e.target.matches('.btn-delete') ? e.target : e.target.closest('.btn-delete');
            const rowId = btn.dataset.rowId;
            if (rowId) deleteRow(rowId);
        }
        
        if (e.target.matches('.select-employee')) {
            const rowId = e.target.dataset.rowId;
            const empId = parseInt(e.target.dataset.empId);
            const empName = e.target.dataset.empName;
            if (rowId && empId) selectEmployee(rowId, empId, empName);
        }
        
        if (e.target.matches('.select-subjob')) {
            const rowId = e.target.dataset.rowId;
            const subjobId = parseInt(e.target.dataset.subjobId);
            const subjobName = e.target.dataset.subjobName;
            if (rowId && subjobId) {
                selectSubjob(rowId, subjobId, subjobName);
                setTimeout(() => navigateFromField(rowId, 'subjob'), 50);
            }
        }
    });
}

function setupEventListeners() {
    const jobSearch = document.getElementById('jobSearch');
    if (jobSearch) {
        jobSearch.addEventListener('input', function(e) {
            const q = e.target.value.trim();
            const resultsDiv = document.getElementById('jobResults');
            if (!q) {
                resultsDiv.style.display = 'none';
                return;
            }
            fetch('/api/jobs/search?q=' + encodeURIComponent(q))
                .then(r => r.json())
                .then(jobs => {
                    const filtered = advancedFilterSearch(jobs, q, 'name');
                    if (filtered.length === 0) {
                        resultsDiv.style.display = 'none';
                        return;
                    }
                    resultsDiv.innerHTML = filtered.map(j => 
                        `<div onclick="selectJob(${j.id}, '${escapeJsString(j.name)}')">${escapeHtml(j.name)} (ID: ${j.id})</div>`
                    ).join('');
                    resultsDiv.style.display = 'block';
                })
                .catch(err => {
                    console.error('Error searching jobs:', err);
                    showError('Failed to search jobs');
                });
        });
    }

    const dataEntrySearch = document.getElementById('dataEntryEmployeeSearch');
    if (dataEntrySearch) {
        dataEntrySearch.addEventListener('input', function(e) {
            const q = e.target.value.trim();
            const resultsDiv = document.getElementById('dataEntryEmployeeResults');
            if (!q) {
                resultsDiv.style.display = 'none';
                return;
            }
            const filtered = advancedFilterSearch(employees, q, 'name');
            if (filtered.length === 0) {
                resultsDiv.style.display = 'none';
                return;
            }
            resultsDiv.innerHTML = filtered.map(e => 
                `<div onclick="selectDataEntryEmployee(${e.id}, '${escapeJsString(e.name)}')">${escapeHtml(e.name)} (ID: ${e.id})</div>`
            ).join('');
            resultsDiv.style.display = 'block';
        });
    }

    document.addEventListener('click', function(e) {
        if (!e.target.closest('.search-container')) {
            const jobResults = document.getElementById('jobResults');
            const dataEntryResults = document.getElementById('dataEntryEmployeeResults');
            if (jobResults) jobResults.style.display = 'none';
            if (dataEntryResults) dataEntryResults.style.display = 'none';
            document.querySelectorAll('.employee-results').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.subjob-results').forEach(el => el.style.display = 'none');
        }
        if (!e.target.closest('input[id^="startTimeInput"]') && !e.target.closest('input[id^="endTimeInput"]')) {
            document.querySelectorAll('input[id^="startTimeInput"]').forEach(el => el.placeholder = '');
            document.querySelectorAll('input[id^="endTimeInput"]').forEach(el => el.placeholder = '');
        }
    });
}

function selectDataEntryEmployee(id, name) {
    dataEntryEmployee = {id, name};
    const resultsDiv = document.getElementById('dataEntryEmployeeResults');
    const searchInput = document.getElementById('dataEntryEmployeeSearch');
    if (resultsDiv) resultsDiv.style.display = 'none';
    if (searchInput) searchInput.value = name;
    
    schedules.forEach((s) => {
        if (!s.schedule_id) {
            s.form_id = id.toString();
        }
    });
    render();
    
    updateURLFromState();
}

function onDateModeChange() {
    const mode = document.querySelector('input[name="dateMode"]:checked')?.value;
    isDateRangeMode = mode === 'range';
    
    const singleContainer = document.getElementById('singleDateContainer');
    const rangeContainer = document.getElementById('dateRangeContainer');
    
    if (isDateRangeMode) {
        singleContainer?.classList.add('hidden');
        rangeContainer?.classList.remove('hidden');
        currentDate = null;
        const workDate = document.getElementById('workDate');
        if (workDate) workDate.value = '';
    } else {
        singleContainer?.classList.remove('hidden');
        rangeContainer?.classList.add('hidden');
        dateRangeStart = null;
        dateRangeEnd = null;
        const startDate = document.getElementById('startDate');
        const endDate = document.getElementById('endDate');
        if (startDate) startDate.value = '';
        if (endDate) endDate.value = '';
    }
    
    schedules = [];
    editingRows.clear();
    rawHoursCache = {};
    rowIdMap.clear();
    render();
    
    const scheduleHeader = document.getElementById('scheduleHeader');
    if (scheduleHeader) scheduleHeader.innerText = 'Schedules';
    
    updateURLFromState();
}

function onSingleDateChange() {
    const workDate = document.getElementById('workDate');
    editingRows.clear();
    currentDate = workDate?.value || null;
    
    const existingDates = document.getElementById('existingDates');
    if (existingDates) existingDates.value = '';
    
    updateURLFromState();
    
    if (currentJob && currentDate) {
        autoLoad();
    }
}

function onExistingDateSelect(date) {
    editingRows.clear();
    if (date) {
        const workDate = document.getElementById('workDate');
        if (workDate) workDate.value = date;
        currentDate = date;
        
        updateURLFromState();
        
        if (currentJob) {
            autoLoad();
        }
    }
}

function onDateRangeChange() {
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    
    dateRangeStart = startDate?.value || null;
    dateRangeEnd = endDate?.value || null;
    
    if (dateRangeStart && dateRangeEnd) {
        if (dateRangeStart > dateRangeEnd) {
            showError('Start date must be before end date');
            return;
        }
        editingRows.clear();
        updateURLFromState();
        loadDateRange();
    } else {
        updateURLFromState();
    }
}

function searchDateRange() {
    if (!currentJob) {
        showError('Select a job first');
        return;
    }
    if (!dateRangeStart || !dateRangeEnd) {
        showError('Please select both start and end dates');
        return;
    }
    if (dateRangeStart > dateRangeEnd) {
        showError('Start date must be before end date');
        return;
    }
    
    editingRows.clear();
    loadDateRange();
}

function clearDateRange() {
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    if (startDate) startDate.value = '';
    if (endDate) endDate.value = '';
    dateRangeStart = null;
    dateRangeEnd = null;
    schedules = [];
    editingRows.clear();
    rawHoursCache = {};
    rowIdMap.clear();
    render();
    
    const scheduleHeader = document.getElementById('scheduleHeader');
    if (scheduleHeader) scheduleHeader.innerText = 'Schedules';
    
    updateURLFromState();
}

function loadDateRange() {
    if (!currentJob || !dateRangeStart || !dateRangeEnd) return;
    
    fetch(`/api/jobs/${currentJob.id}/schedules/range?start_date=${dateRangeStart}&end_date=${dateRangeEnd}`)
        .then(r => {
            if (!r.ok) throw new Error('Failed to load schedules');
            return r.json();
        })
        .then(data => {
            schedules = data.schedules || [];
            schedules.forEach(s => {
                if (!s._rowId) s._rowId = s.schedule_id || generateTempId();
            });
            render();
            const scheduleHeader = document.getElementById('scheduleHeader');
            if (scheduleHeader) {
                scheduleHeader.innerText = `${currentJob.name} - ${dateRangeStart} to ${dateRangeEnd}`;
            }
        })
        .catch(err => {
            console.error('Error loading schedules:', err);
            showError('Failed to load schedules');
        });
}

function selectJob(id, name) {
    currentJob = {id, name};
    editingRows.clear();
    const jobResults = document.getElementById('jobResults');
    const jobSearch = document.getElementById('jobSearch');
    if (jobResults) jobResults.style.display = 'none';
    if (jobSearch) jobSearch.value = name;
    
    updateURLFromState();
    
    fetch('/api/jobs/' + id + '/subjobs')
        .then(r => r.json())
        .then(data => {
            subjobs = data;
        })
        .catch(err => {
            console.error('Error loading subjobs:', err);
            showError('Failed to load subjobs');
        });
    
    fetch('/api/jobs/' + id + '/dates')
        .then(r => r.json())
        .then(dates => {
            const dropdown = document.getElementById('existingDates');
            if (dropdown) {
                dropdown.innerHTML = '<option value="">-- Existing Dates --</option>' + 
                    dates.map(d => `<option value="${d}">${d}</option>`).join('');
            }
            
            if (!isDateRangeMode) {
                const dateVal = document.getElementById('workDate')?.value;
                if (dateVal) {
                    currentDate = dateVal;
                    autoLoad();
                }
            }
        })
        .catch(err => {
            console.error('Error loading dates:', err);
            showError('Failed to load dates');
        });
}

function autoLoad() {
    if (!currentJob || !currentDate) return;
    
    fetch(`/api/jobs/${currentJob.id}/schedules?date=${currentDate}`)
        .then(r => {
            if (!r.ok) throw new Error('Failed to load schedules');
            return r.json();
        })
        .then(data => {
            schedules = data.schedules || [];
            schedules.forEach(s => {
                if (!s._rowId) s._rowId = s.schedule_id || generateTempId();
            });
            render();
            const scheduleHeader = document.getElementById('scheduleHeader');
            if (scheduleHeader) {
                scheduleHeader.innerText = `${currentJob.name} - ${currentDate}`;
            }
        })
        .catch(err => {
            console.error('Error loading schedules:', err);
            showError('Failed to load schedules');
        });
}

function calculateHours(startTime, endTime, lunch) {
    if (!startTime || !endTime) return 0;
    const start = new Date(`2000-01-01T${startTime}`);
    const end = new Date(`2000-01-01T${endTime}`);
    let diffMs = end - start;
    if (diffMs < 0) diffMs += 24 * 60 * 60 * 1000;
    const diffHours = diffMs / (1000 * 60 * 60);
    
    // Subtract lunch break (default to 0.5 if not provided)
    const lunchHours = parseFloat(lunch) || 0;
    const paidHours = diffHours - lunchHours;
    
    // Don't allow negative hours
    return Math.max(0, Math.round(paidHours * 2) / 2);
}
function updateRawHours(rowId) {
    const s = schedules.find(sch => sch._rowId === rowId);
    if (!s) return 0;
    // Pass lunch to the calculation
    rawHoursCache[rowId] = calculateHours(s.start_time, s.end_time, s.lunch);
    return rawHoursCache[rowId];
}

function getRawHours(rowId) {
    return rawHoursCache[rowId] || 0;
}

function getSuggestedOT(rowId) {
    const s = schedules.find(sch => sch._rowId === rowId);
    if (!s) return 0;
    const rawHours = getRawHours(rowId);
    const enteredHours = parseFloat(s.hours) || 0;
    if (enteredHours < rawHours) {
        return Math.round((rawHours - enteredHours) * 2) / 2;
    }
    return 0;
}

function onTimeChange(rowId, field, value) {
    const s = schedules.find(sch => sch._rowId === rowId);
    if (!s) return;
    s[field] = value;
    if (s.start_time && s.end_time) {
        updateRawHours(rowId);
    }
}

function applyTimeValue(rowId, field, value) {
    const s = schedules.find(sch => sch._rowId === rowId);
    if (!s) return;
    
    s[field] = value;
    const inputId = field === 'start_time' ? `startTimeInput${rowId}` : `endTimeInput${rowId}`;
    const input = document.getElementById(inputId);
    if (input) {
        input.value = value;
        input.placeholder = '';
    }
    
    if (s.start_time && s.end_time) {
        updateRawHours(rowId);
    }
}

function onHoursFocus(rowId) {
    const rawHours = getRawHours(rowId);
    if (rawHours <= 0) return;
    const input = document.getElementById(`hoursInput${rowId}`);
    if (!input || input.value) return;
    input.placeholder = rawHours.toString();
}

function onHoursBlur(rowId) {
    const input = document.getElementById(`hoursInput${rowId}`);
    if (input) input.placeholder = '';
}

function onHoursChange(rowId, value) {
    const s = schedules.find(sch => sch._rowId === rowId);
    if (!s) return;
    s.hours = value;
    const input = document.getElementById(`hoursInput${rowId}`);
    if (input) input.placeholder = '';
    const suggestedOT = getSuggestedOT(rowId);
    if (suggestedOT > 0) {
        s._suggestedOT = suggestedOT;
    } else {
        delete s._suggestedOT;
    }
}

function applyHoursValue(rowId, value) {
    const s = schedules.find(sch => sch._rowId === rowId);
    if (!s) return;
    s.hours = value;
    const input = document.getElementById(`hoursInput${rowId}`);
    if (input) {
        input.value = value;
        input.placeholder = '';
    }
    const suggestedOT = getSuggestedOT(rowId);
    if (suggestedOT > 0) {
        s._suggestedOT = suggestedOT;
    }
}

function onOTFocus(rowId) {
    const s = schedules.find(sch => sch._rowId === rowId);
    if (!s) return;
    const suggestedOT = s._suggestedOT || getSuggestedOT(rowId);
    if (suggestedOT <= 0) return;
    const input = document.getElementById(`otInput${rowId}`);
    if (!input || input.value) return;
    input.placeholder = suggestedOT.toString();
    s._suggestedOT = suggestedOT;
}

function onOTBlur(rowId) {
    const input = document.getElementById(`otInput${rowId}`);
    if (input) input.placeholder = '';
}

function applyOTValue(rowId, value) {
    const s = schedules.find(sch => sch._rowId === rowId);
    if (!s) return;
    s.ot_hours = value;
    const input = document.getElementById(`otInput${rowId}`);
    if (input) {
        input.value = value;
        input.placeholder = '';
    }
}

function onQualifiedChange(rowId, isChecked) {
    const s = schedules.find(sch => sch._rowId === rowId);
    if (s) s.qualified = isChecked;
}

function render() {
    const tbody = document.getElementById('scheduleBody');
    if (!tbody) return;
    
    rowIdMap.clear();
    
    // Build table rows
    let html = '';
    
    schedules.forEach((s, index) => {
        const rowId = s._rowId || (s._rowId = s.schedule_id || generateTempId());
        rowIdMap.set(index, rowId);
        
        const isExisting = !!s.schedule_id;
        const isEditing = editingRows.has(rowId);
        const readOnlyClass = (isExisting && !isEditing) ? 'read-only' : '';
        const disabledAttr = (isExisting && !isEditing) ? 'disabled' : '';
        const pointerEvents = (isExisting && !isEditing) ? 'none' : 'auto';
        
        let displayDate = '-';
        if (s.work_date) {
            const parts = s.work_date.split(/[-\/]/);
            if (parts.length === 3) {
                displayDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
            } else {
                displayDate = s.work_date;
            }
        }
        
        html += `
        <tr class="${readOnlyClass}" id="row${rowId}" data-row-id="${rowId}">
            <td>
                <div class="search-container">
                    <input type="text" 
                           class="employee-search" 
                           id="empSearch${rowId}"
                           value="${escapeHtml(s.employee_name || '')}" 
                           placeholder="Search employee..."
                           autocomplete="off"
                           oninput="searchEmployee(this, '${rowId}')"
                           onfocus="showEmployeeDropdown('${rowId}')"
                           ${disabledAttr}
                           style="pointer-events: ${pointerEvents}">
                    <div class="employee-results" id="empResults${rowId}"></div>
                </div>
            </td>
            <td>
                <div class="search-container">
                    <input type="text" 
                           class="subjob-search" 
                           id="subjobSearch${rowId}"
                           value="${escapeHtml(s.subjob_name || '')}" 
                           placeholder="Search subjob..."
                           autocomplete="off"
                           oninput="searchSubjob(this, '${rowId}')"
                           onfocus="showSubjobDropdown('${rowId}')"
                           onkeydown="onSubjobKeyDown('${rowId}', event)"
                           ${disabledAttr}
                           style="pointer-events: ${pointerEvents}">
                    <div class="subjob-results" id="subjobResults${rowId}"></div>
                </div>
            </td>
            <td>
                <input type="checkbox" 
                       ${s.qualified ? 'checked' : ''} 
                       onchange="onQualifiedChange('${rowId}', this.checked)" 
                       onkeydown="onQualifiedKeyDown('${rowId}', event)"
                       ${disabledAttr}>
            </td>
            <td><input type="time" value="${s.start_time || ''}" 
                       onchange="onTimeChange('${rowId}', 'start_time', this.value)" 
                       onkeydown="onTimeKeyDown('${rowId}', 'start_time', event)"
                       ${disabledAttr} 
                       id="startTimeInput${rowId}"></td>
            <td><input type="time" value="${s.end_time || ''}" 
                       onchange="onTimeChange('${rowId}', 'end_time', this.value)" 
                       onkeydown="onTimeKeyDown('${rowId}', 'end_time', event)"
                       ${disabledAttr} 
                       id="endTimeInput${rowId}"></td>
            <td><input type="number" step="0.5" value="${s.lunch !== undefined && s.lunch !== null ? s.lunch : ''}" 
                       onchange="updateScheduleField('${rowId}', 'lunch', this.value)" 
                       onkeydown="onLunchKeyDown('${rowId}', event)"
                       style="width:60px" 
                       ${disabledAttr}
                       id="lunchInput${rowId}"
                       placeholder="0.5"></td>
            <td>
                <input type="number" step="0.5" value="${s.hours || ''}" 
                       onchange="onHoursChange('${rowId}', this.value)" 
                       onfocus="onHoursFocus('${rowId}')"
                       onblur="onHoursBlur('${rowId}')"
                       onkeydown="onHoursKeyDown('${rowId}', event)"
                       style="width:60px" ${disabledAttr}
                       id="hoursInput${rowId}"
                       placeholder="">
            </td>
            <td>
                <input type="number" step="0.5" value="${s.ot_hours || ''}" 
                       onchange="updateScheduleField('${rowId}', 'ot_hours', this.value)" 
                       onfocus="onOTFocus('${rowId}')"
                       onblur="onOTBlur('${rowId}')"
                       onkeydown="onOTKeyDown('${rowId}', event)"
                       style="width:60px" ${disabledAttr}
                       id="otInput${rowId}"
                       placeholder="">
            </td>
            <td><input value="${escapeHtml(s.description || '')}" 
                       onchange="updateScheduleField('${rowId}', 'description', this.value)" 
                       onkeydown="onDescriptionKeyDown('${rowId}', event)"
                       size="20" 
                       ${disabledAttr}
                       id="descInput${rowId}"></td>
            <td>
                ${isExisting && !isEditing ? 
                    displayDate : 
                    `<input type="date" value="${s.work_date || currentDate || ''}" 
                            onchange="updateScheduleField('${rowId}', 'work_date', this.value)" 
                            ${disabledAttr}>`
                }
            </td>
            <td>
                ${isExisting ? 
                    (isEditing ? 
                        `<button class="btn-small btn-save btn-save-row" data-row-id="${rowId}" title="Save Changes">💾</button>` : 
                        `<button class="btn-small btn-edit" data-row-id="${rowId}" title="Edit">✎</button>`
                    ) : 
                    `<button class="btn-small btn-save btn-save-row" data-row-id="${rowId}" title="Save">💾</button>`
                }
                <button class="btn-small btn-delete" data-row-id="${rowId}" title="Remove">✕</button>
            </td>
            <td style="background-color: #f0f0f0; color: #666;">
                ${escapeHtml(s.form_id || (dataEntryEmployee ? dataEntryEmployee.id : '')) || '-'}
            </td>
        </tr>
        `;
    });
    
    // Add "Add Row" button row at the bottom
    html += `
        <tr id="addRowButtonRow">
            <td colspan="12" style="text-align: left; padding: 8px 12px; background-color: #f8f9fa; border-top: 1px solid #dee2e6;">
                <button onclick="addRowAndScroll()" style="padding: 6px 16px; font-size: 12px; cursor: pointer; background-color: #28a745; color: white; border: none; border-radius: 4px; transition: background-color 0.2s;">
                    + Add Row
                </button>
            </td>
        </tr>
    `;
    
    tbody.innerHTML = html;
    
    setupDynamicEnterKeyHandlers();
}

function addRowAndScroll() {
    // Call the existing addRow logic
    if (!currentJob) {
        showError('Select a job first');
        return;
    }
    
    let dateToUse;
    if (isDateRangeMode) {
        if (!dateRangeStart) {
            showError('Select a start date first');
            return;
        }
        dateToUse = dateRangeStart;
    } else {
        dateToUse = currentDate || document.getElementById('workDate')?.value;
        if (!dateToUse) {
            showError('Select a date first');
            return;
        }
    }
    
    if (!dataEntryEmployee) {
        showError('Select data entry employee first');
        return;
    }
    
    const newRowId = generateTempId();
    schedules.push({
        _rowId: newRowId,
        employee_id: '', 
        employee_name: '', 
        subjob_id: '', 
        subjob_name: '',
        form_id: dataEntryEmployee.id.toString(),
        qualified: false,
        start_time: '', 
        end_time: '', 
        lunch: 0.5,
        hours: 0, 
        ot_hours: 0, 
        description: '',
        work_date: dateToUse
    });
    editingRows.add(newRowId);
    render();
    
    // Scroll to the new row (second to last, since last is the add button)
    setTimeout(() => {
        const newRow = document.getElementById(`row${newRowId}`);
        if (newRow) {
            newRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Focus the employee search field
            const empInput = document.getElementById(`empSearch${newRowId}`);
            if (empInput) empInput.focus();
        }
    }, 100);
}

function setupDynamicEnterKeyHandlers() {
    schedules.forEach((s) => {
        const rowId = s._rowId;
        const isExisting = !!s.schedule_id;
        const isEditing = editingRows.has(rowId);
        
        if (!isExisting || isEditing) {
            const empInput = document.getElementById(`empSearch${rowId}`);
            const empResults = document.getElementById(`empResults${rowId}`);
            const subjobInput = document.getElementById(`subjobSearch${rowId}`);
            const subjobResults = document.getElementById(`subjobResults${rowId}`);
            
            if (empInput && empResults) {
                setupDynamicEnterKeySearch(empInput, empResults);
            }
            if (subjobInput && subjobResults) {
                setupDynamicEnterKeySearch(subjobInput, subjobResults);
            }
        }
    });
}

function updateScheduleField(rowId, field, value) {
    const s = schedules.find(sch => sch._rowId === rowId);
    if (s) s[field] = value;
}

function enableEdit(rowId) {
    editingRows.add(rowId);
    render();
}

function searchEmployee(input, rowId) {
    if (!editingRows.has(rowId)) {
        const s = schedules.find(sch => sch._rowId === rowId);
        if (s && s.schedule_id) return;
    }
    
    const q = input.value.trim();
    const resultsDiv = document.getElementById(`empResults${rowId}`);
    
    if (!q) {
        showEmployeeDropdown(rowId);
        return;
    }
    
    const filtered = advancedFilterSearch(employees, q, 'name').slice(0, 5);
    
    if (filtered.length === 0) {
        if (resultsDiv) resultsDiv.style.display = 'none';
        return;
    }
    
    if (resultsDiv) {
        resultsDiv.innerHTML = filtered.map(e => 
            `<div class="select-employee" 
                data-row-id="${rowId}" 
                data-emp-id="${e.id}" 
                data-emp-name="${escapeJsString(e.name)}">
                ${escapeHtml(e.name)} (ID: ${e.id})
            </div>`
        ).join('');
        resultsDiv.style.display = 'block';
    }
}

function showEmployeeDropdown(rowId) {
    const s = schedules.find(sch => sch._rowId === rowId);
    if (!editingRows.has(rowId) && s && s.schedule_id) return;
    if (employees.length === 0) return;
    
    const resultsDiv = document.getElementById(`empResults${rowId}`);
    if (!resultsDiv) return;
    
    const sortedEmployees = [...employees].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 5);
    
    resultsDiv.innerHTML = sortedEmployees.map(e => 
        `<div class="select-employee" 
            data-row-id="${rowId}" 
            data-emp-id="${e.id}" 
            data-emp-name="${escapeJsString(e.name)}">
            ${escapeHtml(e.name)} (ID: ${e.id})
        </div>`
    ).join('');
    resultsDiv.style.display = 'block';
}

function searchSubjob(input, rowId) {
    const s = schedules.find(sch => sch._rowId === rowId);
    if (!editingRows.has(rowId) && s && s.schedule_id) return;
    
    const q = input.value.trim();
    const resultsDiv = document.getElementById(`subjobResults${rowId}`);
    
    if (!q) {
        showSubjobDropdown(rowId);
        return;
    }
    
    const filtered = advancedFilterSearch(subjobs, q, 'name');
    
    if (filtered.length === 0) {
        if (resultsDiv) resultsDiv.style.display = 'none';
        return;
    }
    
    if (resultsDiv) {
        resultsDiv.innerHTML = filtered.map(sj => 
            `<div class="select-subjob" 
                data-row-id="${rowId}" 
                data-subjob-id="${sj.id}" 
                data-subjob-name="${escapeJsString(sj.name)}">
                ${escapeHtml(sj.name)}
            </div>`
        ).join('');
        resultsDiv.style.display = 'block';
    }
}

function showSubjobDropdown(rowId) {
    const s = schedules.find(sch => sch._rowId === rowId);
    if (!editingRows.has(rowId) && s && s.schedule_id) return;
    if (subjobs.length === 0) return;
    
    const resultsDiv = document.getElementById(`subjobResults${rowId}`);
    if (!resultsDiv) return;
    
    const sortedSubjobs = [...subjobs].sort((a, b) => a.name.localeCompare(b.name));
    
    resultsDiv.innerHTML = sortedSubjobs.map(sj => 
        `<div class="select-subjob" 
            data-row-id="${rowId}" 
            data-subjob-id="${sj.id}" 
            data-subjob-name="${escapeJsString(sj.name)}">
            ${escapeHtml(sj.name)}
        </div>`
    ).join('');
    resultsDiv.style.display = 'block';
}

function selectSubjob(rowId, id, name) {
    const s = schedules.find(sch => sch._rowId === rowId);
    if (!s) return;
    
    s.subjob_id = id;
    s.subjob_name = name;
    
    const subjobSearch = document.getElementById(`subjobSearch${rowId}`);
    const subjobResults = document.getElementById(`subjobResults${rowId}`);
    
    if (subjobSearch) subjobSearch.value = name;
    if (subjobResults) subjobResults.style.display = 'none';
}

function addRow() {
    if (!currentJob) {
        showError('Select a job first');
        return;
    }
    
    let dateToUse;
    if (isDateRangeMode) {
        if (!dateRangeStart) {
            showError('Select a start date first');
            return;
        }
        dateToUse = dateRangeStart;
    } else {
        dateToUse = currentDate || document.getElementById('workDate')?.value;
        if (!dateToUse) {
            showError('Select a date first');
            return;
        }
    }
    
    if (!dataEntryEmployee) {
        showError('Select data entry employee first');
        return;
    }
    
    const newRowId = generateTempId();
    schedules.push({
        _rowId: newRowId,
        employee_id: '', 
        employee_name: '', 
        subjob_id: '', 
        subjob_name: '',
        form_id: dataEntryEmployee.id.toString(),
        qualified: false,
        start_time: '', 
        end_time: '', 
        lunch: 0.5,
        hours: 0, 
        ot_hours: 0, 
        description: '',
        work_date: dateToUse
    });
    editingRows.add(newRowId);
    render();
}

function deleteRow(rowId) {
    const index = schedules.findIndex(s => s._rowId === rowId);
    if (index === -1) return;
    
    const s = schedules[index];
    if (s.schedule_id && !confirm('Delete saved record?')) return;
    
    if (s.schedule_id) {
        fetch('/api/schedules/' + s.schedule_id, {method: 'DELETE'})
            .then(r => {
                if (!r.ok) throw new Error('Failed to delete');
                return r.json();
            })
            .then(() => {
                schedules.splice(index, 1);
                editingRows.delete(rowId);
                delete rawHoursCache[rowId];
                render();
                showSuccess('Record deleted successfully');
            })
            .catch(err => {
                console.error('Error deleting:', err);
                showError('Failed to delete record');
            });
    } else {
        schedules.splice(index, 1);
        editingRows.delete(rowId);
        delete rawHoursCache[rowId];
        render();
    }
}

function saveSingleRow(rowId) {
    const row = schedules.find(s => s._rowId === rowId);
    if (!row) return;
    
    if (!row.employee_id) {
        showError('Please select an employee first');
        return;
    }
    
    if (!currentJob) {
        showError('Please select a job first');
        return;
    }
    
    let dateToUse = row.work_date || currentDate || dateRangeStart;
    if (!dateToUse) {
        showError('Please select a date first');
        return;
    }
    
    // Clear cache for this employee to force fresh fetch next time
    if (row.employee_id) {
        delete recentScheduleCache[row.employee_id];
    }
    
    // Store which rows are currently editing (except the one we're saving)
    const otherEditingRows = new Set();
    editingRows.forEach(id => {
        if (id !== rowId) otherEditingRows.add(id);
    });
    
    const payload = {
        date: dateToUse,
        rows: [{
            schedule_id: row.schedule_id,
            employee_id: row.employee_id,
            subjob_id: row.subjob_id,
            form_id: row.form_id || (dataEntryEmployee ? dataEntryEmployee.id.toString() : ''),
            qualified: row.qualified,
            start_time: row.start_time,
            end_time: row.end_time,
            lunch: row.lunch,
            hours: row.hours,
            ot_hours: row.ot_hours,
            description: row.description,
            work_date: row.work_date || dateToUse
        }]
    };
    
    fetch(`/api/jobs/${currentJob.id}/schedules/save`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(res => {
        if (res.success) {
            showSuccess(`Row saved (Created: ${res.created}, Updated: ${res.updated})`);
            
            // Remove this row from editing state
            editingRows.delete(rowId);
            
            // If a new row was created, we need to get the new schedule_id
            if (res.created > 0 && !row.schedule_id) {
                // Fetch the specific date to get the new schedule_id
                fetch(`/api/jobs/${currentJob.id}/schedules?date=${dateToUse}`)
                    .then(r => r.json())
                    .then(data => {
                        // Find the newly created row by matching employee_id and other fields
                        const newRowData = data.schedules.find(s => 
                            s.employee_id == row.employee_id && 
                            s.work_date == dateToUse &&
                            Math.abs(s.hours - row.hours) < 0.01
                        );
                        
                        if (newRowData) {
                            // Update the existing row with the new schedule_id
                            row.schedule_id = newRowData.schedule_id;
                            // Update other fields from server if needed
                            row.form_id = newRowData.form_id;
                        }
                        
                        // Restore editing state for other rows
                        otherEditingRows.forEach(id => editingRows.add(id));
                        render();
                    })
                    .catch(err => {
                        console.error('Error fetching updated row:', err);
                        // Still restore editing state even if fetch fails
                        otherEditingRows.forEach(id => editingRows.add(id));
                        render();
                    });
            } else {
                // Just re-render without reloading - preserves other rows
                render();
            }
        } else {
            showError('Save had errors: ' + (res.errors || []).join(', '));
        }
    })
    .catch(err => {
        console.error('Error saving row:', err);
        showError('Failed to save row');
    });
}

function saveAll() {
    if (!currentJob) {
        showError('Select a job first');
        return;
    }
    if (!dataEntryEmployee) {
        showError('Select data entry employee first');
        return;
    }
    
    let dateContext;
    if (isDateRangeMode) {
        if (!dateRangeStart) {
            showError('Select a date range first');
            return;
        }
        dateContext = dateRangeStart;
    } else {
        dateContext = currentDate || document.getElementById('workDate')?.value;
        if (!dateContext) {
            showError('Select a date first');
            return;
        }
    }

    const rowsToSave = schedules.map(s => {
        if (!s.schedule_id && !s.form_id) {
            s.form_id = dataEntryEmployee.id.toString();
        }
        if (!s.work_date) {
            s.work_date = dateContext;
        }
        return s;
    });
    
    fetch(`/api/jobs/${currentJob.id}/schedules/save`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            date: dateContext, 
            rows: rowsToSave
        })
    })
    .then(r => {
        if (!r.ok) throw new Error('Save failed');
        return r.json();
    })
    .then(res => {
        // Clear cache after bulk save
        recentScheduleCache = {};
        
        const msg = `Created: ${res.created}, Updated: ${res.updated}${res.errors?.length ? ', Errors: ' + res.errors.length : ''}`;
        if (res.success && (!res.errors || res.errors.length === 0)) {
            showSuccess(msg);
        } else {
            showError(msg);
            if (res.errors && res.errors.length > 0) {
                console.error('Save errors:', res.errors);
            }
        }
        editingRows.clear();
        
        if (isDateRangeMode) {
            loadDateRange();
        } else {
            currentDate = dateContext;
            autoLoad();
        }
    })
    .catch(err => {
        console.error('Error:', err);
        showError('Save failed - check console');
    });
}