// Device object (obtained from user) with interfaces -- disconnect?
// - Line writes
// - Line reads with timeout
// - Set of awaitable commands
// Save config to localstorage
// Form for input details
// Check battery and configuration status?
// Barcode/QR-code read
// Save log to localstorage (and sync)
/*
Linux: USB devices typically read-only for non-root users.

Add a new udev rule by creating a file at `/etc/udev/rules.d/07-cwa.rules`:

```bash
SUBSYSTEM=="usb", ATTR{idVendor}=="04d8", ATTR{idProduct}=="0057", MODE="0664", GROUP="plugdev"
```

Add the user to the `plugdev` group: `sudo adduser pi plugdev`

# /lib/udev/rules.d/60-serial.rules
# ls /dev/serial/by-id

#sudo udevadm control --reload-rules && udevadm trigger
#lsusb -v -d 04d8:0057


# chromium-browser --disable-webusb-security
*/
/*
// Windows Chrome WebUSB Back-end:  chrome://flags/#new-usb-backend
*/

import { redirectConsole, watchParameters, localTimeString, localTimeValue } from './util.mjs';
import KeyInput from './key_input.mjs';
import DeviceManager from './device_manager.mjs';
import Barcode from './barcode.mjs';

window.addEventListener("error", function (e) {
    document.getElementById('warnings').appendChild(document.createTextNode('⚠️ Unhandled error.'));
    console.error("ERROR: Unhandled error: " + (e.error && e.error.message ? e.error.message : e.error));
    console.error(JSON.stringify(e));
    return false;
});

window.addEventListener("unhandledrejection", function (e) {
    document.getElementById('warnings').appendChild(document.createTextNode('⚠️ Unhandled promise rejection.'));
    console.error("ERROR: Unhandled rejection: " + (e.error && e.error.message ? e.error.message : e.error));
    console.error(JSON.stringify(e));
    return false;
});


redirectConsole('#output');

let currentDevice = null;

window.addEventListener('DOMContentLoaded', async (event) => {
    const deviceManager = new DeviceManager();

    for (let warning of deviceManager.warnings) {
        document.getElementById('warnings').appendChild(document.createTextNode('⚠️ ' + warning));
    }

    const codeInput = '#code';

    const updateEnabled = () => {
        //const code = document.querySelector(codeInput).value;

        let config = null;
        try {
            config = configFromForm();
            //console.log(JSON.stringify(config, null, 4));
            setResult('', false);
        } catch (e) {
            //console.log('CONFIGURATION: ' + e);
            setResult(e, true);
        }

        const enabled = config && !!currentDevice; // && code.length > 0
        keyInput.submitEnabled(enabled);
    }

    const updateStatus = () => {
        let status = {
            deviceId: '-',
            battery: '-',
            state: null,
            errorState: null,
        };

        currentDevice = deviceManager.getSingleDevice();
        if (currentDevice) {
            status.deviceId = currentDevice.serial;
            if (currentDevice.status.battery !== null) {
                status.battery = currentDevice.status.battery.percent;
            }
            status.state = currentDevice.status.state;
            status.errorState = currentDevice.status.errorState;

            document.querySelector('body').classList.add('device-connected');
        } else {
            document.querySelector('body').classList.remove('device-connected');
        }

        document.querySelector('#device-id').value = status.deviceId;
        document.querySelector('#battery-meter').value = Number.isNaN(parseInt(status.battery)) ? 0 : parseInt(status.battery);
        document.querySelector('#battery').value = Number.isNaN(parseInt(status.battery)) ? '-' : status.battery + "%";
        document.querySelector('#state').value = status.state || status.errorState || '-';

        updateEnabled();
    }

    const deviceChanged = async () => {
        currentDevice = deviceManager.getSingleDevice();
        if (!currentDevice) {
            console.log('DEVICECHANGED: (none)');
            updateStatus();
        } else {
            console.log('DEVICECHANGED: ' + currentDevice.serial);
            currentDevice.setStatusHandler(updateStatus);
            console.log('DEVICECHANGED: updateStatus...');
            await currentDevice.updateStatus();
            console.log('STATUS: ' + JSON.stringify(currentDevice.status));
            //updateStatus();
        }
    };

    const updateForm = (config) => {
        document.querySelector('#session-id').value = config.sessionId;
        document.querySelector('#rate').value = config.rate;
        document.querySelector('#range').value = config.range;
        document.querySelector('#start').value = config.start ? localTimeString(config.start).slice(0, -7) : null;
        if (!config.stop && !config.duration && config.duration !== 0) {
            document.querySelector('#duration_days').value = 0;
            document.querySelector('#duration_hours').value = 0;
            document.querySelector('#duration_minutes').value = 0;
            if (document.querySelector('#duration_seconds')) document.querySelector('#duration_seconds').value = 0;    
            durationChanged(0);
        } else if (config.stop) {
            document.querySelector('#stop').value = config.stop ? localTimeString(config.stop).slice(0, -7) : null;
            stopChanged();
        } else {
            durationChanged(config.duration);
        }

        document.querySelector('#metadata').value = config.metadata;
        updateEnabled();
    }

    const getDuration = () => {
        const days = parseFloat(document.querySelector('#duration_days').value);
        const hours = parseFloat(document.querySelector('#duration_hours').value);
        const minutes = parseFloat(document.querySelector('#duration_minutes').value);
        const seconds = parseFloat(document.querySelector('#duration_seconds') ? document.querySelector('#duration_seconds').value : '0');
        return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
    }

    const stopChanged = () => {
        // Recalculate duration
        const start = localTimeValue(document.querySelector('#start').value);
        const stop = localTimeValue(document.querySelector('#stop').value);
        const duration = stop.getTime() - start.getTime();
        const duration_days = Math.floor(duration / 1000 / 60 / 60 / 24);
        const duration_hours = Math.floor((duration / 1000 - (24 * 60 * 60 * duration_days)) / 60 / 60);
        const duration_minutes = Math.floor((duration / 1000 - (24 * 60 * 60 * duration_days + 60 * 60 * duration_hours)) / 60);
        const duration_seconds = duration / 1000 - (24 * 60 * 60 * duration_days + 60 * 60 * duration_hours + 60 * duration_minutes);
        document.querySelector('#duration_days').value = duration_days;
        document.querySelector('#duration_hours').value = duration_hours;
        document.querySelector('#duration_minutes').value = duration_minutes;
        if (document.querySelector('#duration_seconds')) document.querySelector('#duration_seconds').value = duration_seconds;
    }

    const durationChanged = (duration) => {
        if (Number(duration) === duration) {
            const duration_days = Math.floor(duration / 1000 / 60 / 60 / 24);
            const duration_hours = Math.floor((duration / 1000 - (24 * 60 * 60 * duration_days)) / 60 / 60);
            const duration_minutes = Math.floor((duration / 1000 - (24 * 60 * 60 * duration_days + 60 * 60 * duration_hours)) / 60);
            const duration_seconds = duration / 1000 - (24 * 60 * 60 * duration_days + 60 * 60 * duration_hours + 60 * duration_minutes);
            document.querySelector('#duration_days').value = duration_days;
            document.querySelector('#duration_hours').value = duration_hours;
            document.querySelector('#duration_minutes').value = duration_minutes;
            if (document.querySelector('#duration_seconds')) document.querySelector('#duration_seconds').value = duration_seconds; 
        }
        // Recalculate stop
        const start = localTimeValue(document.querySelector('#start').value);
        const durationValue = getDuration();
        if (start) {
            const stop = new Date(start.getTime() + durationValue);
            document.querySelector('#stop').value = localTimeString(stop).slice(0, -7);    
        } else {
            document.querySelector('#stop').value = document.querySelector('#start').value;
        }
    }

    const configFromForm = () => {
        const config = {
            sessionId: parseInt(document.querySelector('#session-id').value),
            rate: parseFloat(document.querySelector('#rate').value),
            range: parseInt(document.querySelector('#range').value),
            start: localTimeValue(document.querySelector('#start').value),
            stop: localTimeValue(document.querySelector('#stop').value),
            metadata: document.querySelector('#metadata').value,
        };
        const notSpecified = [];
        if (typeof config.sessionId !== 'number' || isNaN(config.sessionId)) notSpecified.push('session ID');
        if (typeof config.start !== 'object' || !config.start) notSpecified.push('start time');
        if (typeof config.stop !== 'object' || !config.stop) notSpecified.push('stop time');
        if (notSpecified.length > 0) {
            throw "Not specified: " + notSpecified.join(', ') + '.';
        }
        return config;
    }

    const clearConfig = () => {
        console.log('Clearing config...');
        const config = {
            sessionId: null,
            rate: 100,
            range: 8,
            start: null,
            stop: null,
            metadata: '',
        }
        updateForm(config);
    }

    const setResult = (value, error = false) => {
        const elem = document.querySelector('#result');
        if (error) {
            elem.value = '⚠️ ' + value;
        } else {
            elem.value = value;
        }
    }

    let keyInput = new KeyInput(codeInput);
    const codeChanged = (code) => {
        console.log('CODE: ' + code);

        updateEnabled();
    };
    const submit = async () => {
        const code = document.querySelector(codeInput).value;

        // TODO: Turn code into config

        try {
            setResult('Configuring...', false);
            const config = configFromForm();
            console.log(JSON.stringify(config, null, 4));
            try {
                const status = await currentDevice.configure(config);
                console.log('CONFIG-STATUS: ' + JSON.stringify(status));
                setResult('Configured', false);
            } catch (e) {
                console.log('CONFIG-ERROR: ' + JSON.stringify(e));
                setResult(e, true);
            }
        } catch (e) {
            console.log('CONFIGURATION: ' + e);
            setResult(e, true);
        }

    };

    keyInput.start(codeChanged, submit);

    deviceManager.startup(deviceChanged);

    document.querySelector('#add_device').addEventListener('click', async () => {
        await deviceManager.userAddDevice();
    });

    document.querySelector('#test').addEventListener('click', () => {
        const now = new Date();
        const config = {
            sessionId: 123456789,
            rate: 100,
            range: 8,
            start: new Date(now.getTime() + 1*60*1000),
            stop: new Date(now.getTime() + 2*60*1000),
            metadata: 'Hello_world!',
        };
        updateForm(config);
    });

    watchParameters((params) => {
        console.log('PARAMS: ' + JSON.stringify(params));

        let showDebug = true; // default
        if (typeof params.nodebug !== 'undefined') showDebug = false;
        if (typeof params.debug !== 'undefined') showDebug = true;

        document.querySelector('body').classList.toggle('console', showDebug);

        if (params.config) {
            keyInput.setValue(params.config);
        }
    });

    for (let input of ['#session-id', '#rate', '#range', '#start', '#duration_days', '#duration_hours', '#duration_minutes', '#duration_seconds', '#stop', '#metadata']) {
        const elem = document.querySelector(input);
        if (!elem) {
            if (input === '#duration_seconds') continue;
            throw 'Element not found: ' + input;
        }
        elem.addEventListener('change', updateEnabled);
        elem.addEventListener('input', updateEnabled);
        elem.addEventListener('propertychange', updateEnabled);
    }

    for (let input of ['#duration_days', '#duration_hours', '#duration_minutes', '#duration_seconds']) {
        const elem = document.querySelector(input);
        if (!elem) {
            if (input === '#duration_seconds') continue;
            throw 'Element not found: ' + input;
        }
        elem.addEventListener('change', durationChanged);
        elem.addEventListener('input', durationChanged);
        //elem.addEventListener('propertychange', durationChanged);
    }

    for (let input of ['#stop']) {
        const elem = document.querySelector(input);
        elem.addEventListener('change', stopChanged);
        elem.addEventListener('input', stopChanged);
        //elem.addEventListener('propertychange', stopChanged);
    }

    clearConfig();
   
});
