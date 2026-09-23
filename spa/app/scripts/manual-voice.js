/** Manual, one-shot, on-device speech input. No VAD loop or wake-word owner. */
export class ManualVoiceInput {
  #Recognition;
  #recognition = null;
  #stream = null;
  #transcript = '';
  #releaseRequested = false;
  #finalized = true;
  #preparing = false;
  #stopTimer = 0;
  #finalizeTimer = 0;
  #locale;
  #quality = 'command';
  #inputName = '';
  #audioStarted = false;
  #autoEnd = false;
  #callbacks;

  constructor(callbacks = {}) {
    this.#Recognition = globalThis.SpeechRecognition;
    this.#locale = navigator.language || 'en-US';
    this.#callbacks = callbacks;
  }

  get supported() {
    return Boolean(this.#Recognition && 'processLocally' in this.#Recognition.prototype && navigator.mediaDevices?.getUserMedia);
  }

  #state(value) { this.#callbacks.onState?.(value); }
  #message(value) { this.#callbacks.onMessage?.(value); }
  #capture(value) { this.#callbacks.onCapture?.(value); }
  #stopInput() {
    this.#stream?.getTracks().forEach(track => track.stop());
    this.#stream = null;
  }
  #clearTimers() {
    clearTimeout(this.#stopTimer);
    clearTimeout(this.#finalizeTimer);
  }

  async #ensureLocalPack() {
    if (!this.supported) throw new Error('This browser does not expose on-device speech recognition.');
    if (typeof this.#Recognition.available !== 'function') return 'command';
    for (const quality of ['dictation', 'command']) {
      const options = {langs:[this.#locale], processLocally:true, quality};
      const availability = await this.#Recognition.available(options);
      if (availability === 'available') return quality;
      if (availability !== 'unavailable') {
        this.#message('Installing the local '+this.#locale+' '+quality+' speech pack…');
        if (await this.#Recognition.install(options)) return quality;
      }
    }
    throw new Error('On-device speech recognition is unavailable for '+this.#locale+'.');
  }

  async begin({autoEnd=false}={}) {
    if (this.#recognition || this.#preparing) return;
    this.#preparing = true;
    this.#clearTimers();
    this.#stopInput();
    this.#releaseRequested = false;
    this.#finalized = false;
    this.#transcript = '';
    this.#inputName = '';
    this.#audioStarted = false;
    this.#autoEnd = Boolean(autoEnd);
    this.#capture(true);
    this.#state('MIC · PREPARING LOCAL STT');
    this.#message('Preparing on-device speech recognition…');
    try {
      this.#quality = await this.#ensureLocalPack();
      if (this.#releaseRequested) throw new Error('Hold until the microphone turns red, then speak.');
      this.#stream = await navigator.mediaDevices.getUserMedia({audio:true, video:false});
      const track = this.#stream.getAudioTracks()[0];
      if (!track) throw new Error('The browser did not provide a live microphone track.');
      this.#inputName = track.label || 'default microphone';
      if (this.#releaseRequested) throw new Error('Hold longer so the browser can open the microphone.');

      const recognition = new this.#Recognition();
      this.#recognition = recognition;
      recognition.lang = this.#locale;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.processLocally = true;
      recognition.onstart = () => {
        this.#state('MIC · OPENING AUDIO');
        this.#message('Opening '+this.#inputName+'…');
      };
      recognition.onaudiostart = () => {
        this.#audioStarted = true;
        this.#callbacks.onRecording?.(true);
        this.#state('MIC · RECORDING LOCALLY');
        this.#message('Listening locally on '+this.#inputName+'. Speak, then release.');
      };
      recognition.onaudioend = () => this.#callbacks.onRecording?.(false);
      recognition.onspeechend = () => {
        if (this.#autoEnd && !this.#releaseRequested) this.#stopTimer = setTimeout(() => this.end(), 300);
      };
      recognition.onresult = event => {
        let text = '';
        for (let index=0; index<event.results.length; index++) text += event.results[index][0]?.transcript || '';
        this.#transcript = text.trim();
        this.#callbacks.onInterim?.(this.#transcript);
      };
      recognition.onerror = event => {
        if (event.error === 'aborted') return;
        const message = event.error === 'not-allowed'
          ? 'Microphone permission was denied. Allow it for 127.0.0.1 and try again.'
          : event.error === 'no-speech' ? this.#emptyMessage() : 'Local speech recognition error: '+event.error;
        void this.#fail(message);
      };
      recognition.onend = () => {
        this.#recognition = null;
        this.#callbacks.onRecording?.(false);
        if (this.#autoEnd) this.#releaseRequested = true;
        if (this.#releaseRequested) this.#finalizeTimer = setTimeout(() => { void this.#finalize(); }, 200);
        else void this.#fail('Recognition ended before release. Hold the button and try again.');
      };
      // getUserMedia establishes permission and identifies the selected input.
      // Release that probe before SpeechRecognition acquires the microphone itself;
      // some Chromium builds accept start(track) but silently decode no audio.
      this.#stopInput();
      recognition.start();
    } catch (error) {
      await this.#fail(error.message || 'Manual microphone input is unavailable.');
    } finally {
      this.#preparing = false;
    }
  }

  end() {
    if (this.#finalized) return;
    this.#releaseRequested = true;
    this.#state('MIC · FINISHING LOCALLY');
    this.#message('Finishing the last word…');
    if (this.#recognition) {
      this.#stopTimer = setTimeout(() => {
        if (!this.#recognition) return;
        try { this.#recognition.stop(); } catch { void this.#finalize(); }
      }, 450);
    } else if (!this.#preparing) {
      this.#finalizeTimer = setTimeout(() => { void this.#finalize(); }, 200);
    }
  }

  #emptyMessage() {
    return (this.#audioStarted ? 'The microphone opened but returned no transcript.' : 'The microphone audio track did not open.')+
      (this.#inputName ? ' Input: '+this.#inputName+'.' : '');
  }

  async #finalize() {
    if (this.#finalized) return;
    this.#finalized = true;
    this.#clearTimers();
    this.#stopInput();
    this.#capture(false);
    const transcript = this.#transcript.trim();
    if (!transcript) {
      this.#state('MIC · NO SPEECH');
      this.#message(this.#emptyMessage());
      await this.#callbacks.onFinished?.('empty');
      return;
    }
    this.#state('MIC · TRANSCRIBED LOCALLY');
    this.#message('Recognized locally: '+transcript);
    try { await this.#callbacks.onTranscript?.(transcript); } finally { await this.#callbacks.onFinished?.('transcript'); }
  }

  async #fail(message) {
    if (this.#finalized) return;
    this.#finalized = true;
    this.#clearTimers();
    const recognition = this.#recognition;
    this.#recognition = null;
    try { recognition?.abort(); } catch {}
    this.#stopInput();
    this.#callbacks.onRecording?.(false);
    this.#capture(false);
    this.#state('MIC · UNAVAILABLE');
    this.#message(message);
    await this.#callbacks.onFinished?.('failure');
  }

  dispose() {
    this.#finalized = true;
    this.#clearTimers();
    try { this.#recognition?.abort(); } catch {}
    this.#recognition = null;
    this.#stopInput();
    this.#capture(false);
  }
}
