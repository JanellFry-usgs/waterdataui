const { scaleLinear } = require('d3-scale');
const memoize = require('fast-memoize');
const { createSelector, createStructuredSelector } = require('reselect');

const { tsCursorPointsSelector } = require('./cursor');
const { yScaleSelector } = require('./scales');
const { allTimeSeriesSelector } = require('./timeseries');

const { dispatch, link } = require('../../lib/redux');
const { Actions } = require('../../store');


// Higher tones get lower volume
const volumeScale = scaleLinear().range([2, .3]);

const AudioContext = window.AudioContext || window.webkitAudioContext;
const getAudioContext = memoize(function () {
    return new AudioContext();
});

export const createSound = memoize(/* eslint-disable no-unused-vars */ tsKey => {
    const audioCtx = getAudioContext();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    const compressor = audioCtx.createDynamicsCompressor();

    // Connect the oscillator to the gainNode to modulate volume
    oscillator.type = 'sine';
    oscillator.connect(gainNode);

    // Connect the gainNode to the compressor to address clipping
    gainNode.connect(compressor);

    // Connect the compressor to the output context
    compressor.connect(audioCtx.destination);

    // Start the oscillator
    oscillator.start();

    // Initialize with null values so the first pass of updateSound doesn't
    // create a transition.
    oscillator.frequency.setTargetAtTime(null, audioCtx.currentTime, 0);
    gainNode.gain.setTargetAtTime(null, audioCtx.currentTime, 0);

    return {oscillator, gainNode, compressor};
});

export const updateSound = function ({enabled, points}) {
    const audioCtx = getAudioContext();
    for (const tsKey of Object.keys(points)) {
        const point = points[tsKey];
        const {compressor, oscillator, gainNode} = createSound(tsKey);

        compressor.threshold.setValueAtTime(-50, audioCtx.currentTime);
        compressor.knee.setValueAtTime(40, audioCtx.currentTime);
        compressor.ratio.setValueAtTime(12, audioCtx.currentTime);
        compressor.attack.setValueAtTime(0, audioCtx.currentTime);
        compressor.release.setValueAtTime(0.25, audioCtx.currentTime);

        oscillator.frequency.setTargetAtTime(
            enabled && point ? point : null,
            audioCtx.currentTime,
            .2
        );

        gainNode.gain.setTargetAtTime(
            enabled && point ? volumeScale(point) : null,
            audioCtx.currentTime,
            .2
        );
    }
};

export const audibleInterfaceOnSelector = state => state.audibleInterfaceOn;

export const audibleScaleSelector = memoize(tsKey => createSelector(
    yScaleSelector,
    (yScale) => {
        return scaleLinear()
            .domain(yScale.domain())
            .range([80, 1500]);
    }
));

const audiblePointsSelector = createSelector(
    allTimeSeriesSelector,
    tsCursorPointsSelector('current'),
    tsCursorPointsSelector('compare'),
    audibleScaleSelector('current'),
    audibleScaleSelector('compare'),
    (allTimeSeries, currentPoints, comparePoints, yScaleCurrent, yScaleCompare) => {
        // Set null points for all time series, so we can turn audio for those
        // points off when toggling to other time series.
        let points = Object.keys(allTimeSeries).reduce((points, tsID) => {
            points[tsID] = null;
            return points;
        }, {});

        // Get the pitches for the current-year points
        points = Object.keys(currentPoints).reduce((points, tsID) => {
            const pt = currentPoints[tsID];
            points[tsID] = yScaleCurrent(pt.value);
            return points;
        }, points);

        // Get the pitches for the compare-year points
        return Object.keys(comparePoints).reduce((points, tsID) => {
            const pt = comparePoints[tsID];
            points[tsID] = yScaleCompare(pt.value);
            return points;
        }, points);
    }
);

export const audibleUI = function (elem) {
    if (!AudioContext) {
        console.warn('AudioContext not available');
        return;
    }

    elem.append('input')
        .attr('type', 'checkbox')
        .attr('id', 'audible-checkbox')
        .attr('aria-labelledby', 'audible-label')
        .attr('ga-on', 'click')
        .attr('ga-event-category', 'TimeseriesGraph')
        .attr('ga-event-action', 'toggleAudible')
        .on('click', dispatch(function () {
            return Actions.toggleAudibleInterface(this.checked);
        }))
        .call(link(function (elem, checked) {
            elem.property('checked', checked);
        }, audibleInterfaceOnSelector));

    elem.append('label')
        .attr('id', 'audible-label')
        .attr('for', 'audible-checkbox')
        .text('Audible Interface');

    // Listen for focus changes, and play back the audio representation of
    // the selected points.
    // TODO: Handle more than just the first time series of each tsKey. This can
    // piggyback on work to support multiple tooltip selections.
    elem.call(link(function (elem, {enabled, points}) {
        updateSound({
            points,
            enabled
        });
    }, createStructuredSelector({
        enabled: audibleInterfaceOnSelector,
        points: audiblePointsSelector
    })));
};
