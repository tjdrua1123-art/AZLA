(function(g, f) {
  typeof exports === "object" && typeof module !== "undefined" ? f(exports) : typeof define === "function" && define.amd ? define(["exports"], f) : (g = typeof globalThis !== "undefined" ? globalThis : g || self, f(g.WalkPlayWebEqSDK = {}));
})(this, function(exports2) {
  "use strict";var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  var _a;
  const logger = {
    // 日志开关，可通过配置控制
    enabled: true,
    /**
     * 输出日志信息
     * @param {...any} args - 要输出的参数
     */
    log: (...args) => {
      if (logger.enabled) {
        console.log("[SDK]", ...args);
      }
    },
    /**
     * 输出调试信息
     * @param {...any} args - 要输出的参数
     */
    debug: (...args) => {
      if (logger.enabled) {
        console.debug("[SDK]", ...args);
      }
    },
    /**
     * 输出错误信息
     * @param {...any} args - 要输出的参数
     */
    error: (...args) => {
      if (logger.enabled) {
        console.error("[SDK]", ...args);
      }
    },
    /**
     * 输出警告信息
     * @param {...any} args - 要输出的参数
     */
    warn: (...args) => {
      if (logger.enabled) {
        console.warn("[SDK]", ...args);
      }
    },
    /**
     * 设置日志开关
     * @param {boolean} enabled - 是否启用日志
     */
    setEnabled: (enabled) => {
      logger.enabled = enabled;
    }
  };
  class HidService {
    constructor(device) {
      logger.log("初始化设备信息：", device);
      this.device = device;
    }
    async sendReport(reportId, data) {
      this.printHexData(new Uint8Array([reportId]), data);
      await this.device.sendReport(reportId, data);
    }
    async printHexData(...args) {
      let hexString = "";
      for (const arg of args) {
        for (let i = 0; i < arg.length; i++) {
          hexString += arg[i].toString(16).padStart(2, "0").toUpperCase() + " ";
        }
      }
      logger.log("发送数据：", hexString);
    }
  }
  let BaseChip$1 = (_a = class {
    constructor(device) {
      this.groupName = "Base";
      this.deviceTypeNo = "Base";
      this.device = device;
      this.eventMap = /* @__PURE__ */ new Map();
      this._initialized = false;
    }
    /**
     * 初始化芯片
     * 设置设备数据读取监听器，在设备连接后自动调用
     */
    init() {
      if (this._initialized) {
        return;
      }
      if (!this.device) {
        return;
      }
      this.device.addEventListener("inputreport", (event) => {
        const data = new Uint8Array(event.data.buffer);
        logger.log("设备响应数据：");
        this.printHexData(data);
        this.handleInputReport(data);
      });
      this._initialized = true;
    }
    /**
     * 处理设备输入报告数据
     * 子类需要实现此方法来处理各自的数据格式
     * @param {Uint8Array} data - 设备返回的数据
     */
    handleInputReport(data) {
      logger.log("BaseChip 处理设备响应数据：");
      this.printHexData(data);
    }
    /**
     * 添加事件监听器
     * @param {string} eventName - 事件名称
     * @param {Function} callback - 回调函数
     */
    addEventLister(eventName, callback) {
      if (!eventName || typeof callback !== "function") {
        console.warn("addEventLister: 无效的事件名称或回调函数 - eventName: ", eventName);
        return;
      }
      if (!this.eventMap.has(eventName)) {
        this.eventMap.set(eventName, []);
      }
      const listeners = this.eventMap.get(eventName);
      if (!listeners.includes(callback)) {
        listeners.push(callback);
      }
    }
    /**
     * 移除事件监听器
     * @param {string} eventName - 事件名称
     * @param {Function} callback - 要移除的回调函数，如果不提供则移除该事件的所有监听器
     */
    removeEventListener(eventName, callback) {
      if (!this.eventMap.has(eventName)) {
        return;
      }
      if (callback) {
        const listeners = this.eventMap.get(eventName);
        const index = listeners.indexOf(callback);
        if (index > -1) {
          listeners.splice(index, 1);
        }
        if (listeners.length === 0) {
          this.eventMap.delete(eventName);
        }
      } else {
        this.eventMap.delete(eventName);
      }
    }
    /**
     * 触发事件
     * @param {string} eventName - 事件名称
     * @param {...any} args - 传递给回调函数的参数
     */
    emit(eventName, ...args) {
      if (!this.eventMap.has(eventName)) {
        return;
      }
      const listeners = this.eventMap.get(eventName);
      listeners.forEach((callback) => {
        try {
          callback(...args);
        } catch (error) {
          console.error(`事件 ${eventName} 的回调函数执行出错:`, error);
        }
      });
    }
    /**
     * 清除所有事件监听器
     */
    clearAllListeners() {
      this.eventMap.clear();
    }
    /** 基础功能 */
    getGroupName() {
      return this.groupName;
    }
    //获取设备类型编号
    getDeviceTypeNo() {
      return this.deviceTypeNo;
    }
    getFilterIndexs() {
      return {
        //默认以CB系列序列进行编排，用于曲线图的滤波器选择方案
        "LS": 1,
        // Lowshelf
        "PK": 2,
        // Peak
        "HS": 3,
        // Highshelf
        "LP": 4,
        // Lowpass
        "HP": 5
        // Highpass
      };
    }
    getFilterList() {
      return [
        {
          value: 1,
          jc: "LS",
          name: "Lowshelf"
        },
        {
          value: 2,
          jc: "PK",
          name: "Peak"
        },
        {
          value: 3,
          jc: "HS",
          name: "Highshelf"
        },
        {
          value: 4,
          jc: "LP",
          name: "Lowpass"
        },
        {
          value: 5,
          jc: "HP",
          name: "Highpass"
        }
      ];
    }
    /**
     * 获取芯片默认的EQ段数
     * 子类可以重写此方法返回芯片默认支持的EQ段数
     * @returns {number} 默认EQ段数，默认8段
     */
    getDefaultEqSegments() {
      return 8;
    }
    getIsSupportDacFilterMode() {
      return true;
    }
    //是否支持降噪
    getIsSupportNoiseReduction() {
      return false;
    }
    // 恢复出厂设置
    resetDevice() {
      console.log("resetDevice() not implemented");
    }
    // 读取固件版本
    readDeviceVersion() {
      console.log("readDeviceVersion() not implemented");
    }
    // 获取设备相关信息
    getDeviceInfo() {
      console.log("getDeviceInfo() not implemented");
    }
    // 刷新缓存到Flash
    refereshToFlash() {
      console.log("refereshToFlash() not implemented");
    }
    // 读取数据
    deviceRead() {
      console.log("readData() not implemented");
    }
    // 写入数据
    deviceWrite() {
      console.log("writeData() not implemented");
    }
    /** EQ相关 */
    // 读取EQ TagId
    readEqTagId() {
      console.log("readEqTagId() not implemented");
    }
    // 读取ADC EQ TagId
    readAdcEqTagId() {
      throw new Error("readAdcEqTagId() not implemented");
    }
    // 读取设备EQ的全局音量 offset
    readEqOffset() {
      console.log("readEqOffset() not implemented");
    }
    // 设置DAC增益Offset
    setDacOffset(size) {
      console.log("setDacOffset() not implemented");
    }
    // 写入EQ数据到寄存器
    setEqInfo(eq) {
      console.log("setEqInfo() not implemented");
    }
    // 写入EQ数据到寄存器，并刷入Flash
    saveEqInfo(eq) {
      console.log("saveEqInfo() not implemented");
    }
    // EQ数据转换（将界面的EQ参数转换成各芯片可写入的数据）
    getEqBytesFromEQParam() {
      console.log("getEqBytesFromEQParam() not implemented");
    }
    /** 麦克风相关 */
    // 读取麦克风增益（offset）
    readMicphoneOffset() {
      console.log("readMicphoneOffset() not implemented");
    }
    // ENC开关状态读取
    readENC_Switch() {
      console.log("readENC_Switch() not implemented");
    }
    // 设置麦克风增益（offset）
    setMicphoneOffset(size) {
      console.log("setMicphoneOffset() not implemented");
    }
    // 保存设置的增益数据
    saveMicphoneOffset() {
      console.log("saveMicphoneOffset() not implemented");
    }
    setDenoiseSwitch(flag) {
      console.log("denoiseSwitch() not implemented");
    }
    /** 滤波器相关 */
    // 读取设备中滤波器相关信息
    readFilterInfo() {
      console.log("readFilterInfo() not implemented");
    }
    // 读取滤波器ID(下标、序号)
    readFilterIndex() {
      console.log("readFilterInfo() not implemented");
    }
    // 读取滤波器工作模式
    readFilterWorkingMode() {
      console.log("readFilterInfo() not implemented");
    }
    // 读取滤波器输出增益模式
    readFilterOutMode() {
      console.log("readFilterInfo() not implemented");
    }
    // 读取DAC声道平衡
    readDacBalance() {
      console.log("readFilterInfo() not implemented");
    }
    //选择和设置滤波器
    selectFilter(filterCode) {
      console.log("readFilterInfo() not implemented");
    }
    //设置滤波器工作模式
    setDacWorkMode(mode) {
      console.log("readFilterInfo() not implemented");
    }
    // 设置滤波器输出增益模式
    setDacOffsetMode(mode) {
      console.log("readFilterInfo() not implemented");
    }
    //DAC声道平衡
    setDacBalance(left, right) {
      console.log("readFilterInfo() not implemented");
    }
    /** 新增7.1虚拟音效功能 */
    // 读取3D模式开关（0、关闭 1、打开）
    read3DModeSwitch() {
      console.log("read3DModeSwitch() not implemented");
    }
    // 读取3D模式参数（0、GAME 1、MUSIC 2、MOVIE）
    readSoundSource() {
      console.log("readSoundSource() not implemented");
    }
    // 读取3D模式增益（-4 - 0）
    read3DGain() {
      console.log("read3DGain() not implemented");
    }
    // 读取混响（2个参数：0：ON开，1：OFF关，0-9：混响等级）
    readReverb() {
      console.log("readReverb() not implemented");
    }
    // 读取声源音效（0~359度）
    async readSoundSourceAngle() {
      console.log("readSoundSourceAngle() not implemented");
    }
    // 3D模式开关设置（0、关闭 1、打开）
    set3DModeSwitch(flag) {
      console.log("set3DModeSwitch() not implemented");
    }
    // 3D模式参数配置（0、GAME 1、MUSIC 2、MOVIE）
    setModeValue(mode) {
      console.log("setSoundSource() not implemented");
    }
    // 3D模式增益设置（-4 - 0）
    set3DGain(gain) {
      console.log("set3DGain() not implemented");
    }
    // 配置混响（2个参数：0：ON开，1：OFF关，0-9：混响等级）
    setReverb(flag, level) {
      console.log("setReverb() not implemented");
    }
    // 配置声源音效（0~359度）
    setSoundSourceAngle(soundIndex, angle) {
      console.log("setSoundSourceAngle() not implemented");
    }
    resetParams() {
      console.log("resetParams() not implemented");
    }
    // 设置ADC EQ offset
    setAdcOffset(offset) {
      console.log("setAdcOffset() not implemented");
    }
    // 设置ADC EQ信息
    setAdcEqInfo(eq) {
      console.log("setAdcEqInfo() not implemented");
    }
    // 写入ADC EQ数据到寄存器，并刷入Flash
    saveAdcEqInfo(eq) {
      console.log("saveAdcEqInfo() not implemented");
    }
    // 设置ADC耳返开关
    setAdcInEarMonitorsListenSwitch(flag) {
      console.log("setAdcInEarMonitorsListenSwitch() not implemented");
    }
    async printHexData(data) {
      let hexString = "";
      for (let i = 0; i < data.length; i++) {
        hexString += data[i].toString(16).padStart(2, "0").toUpperCase() + " ";
      }
      logger.log(hexString);
    }
  }, /**
   * 事件KEY枚举
   * 用于设备数据回读的事件标识
   */
  __publicField(_a, "EventKeys", {
    // 基础事件
    ReadDeviceVersion: "ReadDeviceVersion",
    // 读取设备版本
    ReadEqTagId: "ReadEqTagId",
    // 读取EQ TagId
    ReadAdcEqTagId: "ReadAdcEqTagId",
    // 读取ADC EQ TagId
    ReadEqOffset: "ReadEqOffset",
    // 读取EQ总增益
    // 麦克风相关
    ReadMicphoneOffset: "ReadMicphoneOffset",
    // 读取麦克风增益
    ReadENC_Switch: "ReadENC_Switch",
    // 读取ENC开关状态
    // 滤波器相关
    ReadFilterIndex: "ReadFilterIndex",
    // 读取滤波器索引
    ReadFilterWorkingMode: "ReadFilterWorkingMode",
    // 读取滤波器工作模式
    ReadFilterGainMode: "ReadFilterGainMode",
    // 读取滤波器增益模式
    ReadDacBalance: "ReadDacBalance",
    // 读取DAC声道平衡
    // CB1300D专用事件
    CB1300D: {
      Read3DModeSwitch: "Read3DModeSwitch",
      // 3D模式开关
      ReadModeValue: "ReadModeValue",
      // 模式
      ReadModeGain: "Read3DGain",
      // 3D模式增益
      ReadReverbSwitch: "ReadReverb",
      // 混响
      ReadReverbValue: "ReadReverbValue",
      // 混响值
      ReadSoundSourceAngle: "ReadSoundSourceAngle"
      // 声源角度
    }
  }), _a);
  class EqFilterBase {
    computeIIRFilter(freq, q, gain) {
      throw new Error("computeIIRFilter method must be implemented in subclass");
    }
    quantizer(a, b) {
      throw new Error("quantizer method must be implemented in subclass");
    }
  }
  class EqFilterPeak extends EqFilterBase {
    //首先算出滤波器的定点量化值
    computeIIRFilter(freq, q, gain, fs = 96e3) {
      const filter = new Array(20).fill(0);
      const f0 = freq;
      const A = Math.sqrt(Math.pow(10, gain / 20));
      const w0 = 2 * Math.PI * f0 / fs;
      const alpha = Math.sin(w0) / (2 * q);
      const b0 = 1 + alpha * A;
      const b1 = -2 * Math.cos(w0);
      const b2 = 1 - alpha * A;
      const a0 = 1 + alpha / A;
      const a1 = -2 * Math.cos(w0);
      const a2 = 1 - alpha / A;
      const b = [b0 / a0, b1 / a0, b2 / a0];
      const a = [1, a1 / a0, a2 / a0];
      const qu = this.quantizer(a, b);
      let idx = 0;
      for (let i = 0; i < qu.length; i++) {
        filter[idx++] = qu[i] >> 0 & 255;
        filter[idx++] = qu[i] >> 8 & 255;
        filter[idx++] = qu[i] >> 16 & 255;
        filter[idx++] = qu[i] >> 24 & 255;
      }
      return filter;
    }
    // 定点量化函数（需要根据具体实现补充逻辑）
    // 浮点数量化为整形
    quantizer(a, b) {
      const scale = 30;
      const data = new Array(5).fill(0);
      const qa = new Array(a.length).fill(0);
      const qb = new Array(b.length).fill(0);
      for (let i = 0; i < a.length; i++) {
        qa[i] = Math.round(a[i] * (1 << scale));
      }
      for (let j = 0; j < b.length; j++) {
        qb[j] = Math.round(b[j] * (1 << scale));
      }
      data[0] = qb[0];
      data[1] = qb[1];
      data[2] = qb[2];
      data[3] = -qa[1];
      data[4] = -qa[2];
      return data;
    }
  }
  class EqFilterLowPass extends EqFilterBase {
    computeIIRFilter(freq, q, gain, fs = 96e3) {
      const filter = new Array(20).fill(0);
      const w0 = 2 * Math.PI * freq / fs;
      const alpha = Math.sin(w0) / (2 * q);
      const b0 = (1 - Math.cos(w0)) / 2;
      const b1 = 1 - Math.cos(w0);
      const b2 = (1 - Math.cos(w0)) / 2;
      const a0 = 1 + alpha;
      const a1 = -2 * Math.cos(w0);
      const a2 = 1 - alpha;
      const b = [b0 / a0, b1 / a0, b2 / a0];
      const a = [1, a1 / a0, a2 / a0];
      const qu = this.quantizer(a, b);
      let idx = 0;
      for (let i = 0; i < qu.length; i++) {
        filter[idx++] = qu[i] >> 0 & 255;
        filter[idx++] = qu[i] >> 8 & 255;
        filter[idx++] = qu[i] >> 16 & 255;
        filter[idx++] = qu[i] >> 24 & 255;
      }
      return filter;
    }
    // 定点量化函数（需要根据具体实现补充逻辑）
    // 浮点数量化为整形
    quantizer(a, b) {
      const scale = 30;
      const data = new Array(5).fill(0);
      const qa = new Array(a.length).fill(0);
      const qb = new Array(b.length).fill(0);
      for (let i = 0; i < a.length; i++) {
        qa[i] = Math.round(a[i] * (1 << scale));
      }
      for (let j = 0; j < b.length; j++) {
        qb[j] = Math.round(b[j] * (1 << scale));
      }
      data[0] = qb[0];
      data[1] = qb[1];
      data[2] = qb[2];
      data[3] = -qa[1];
      data[4] = -qa[2];
      return data;
    }
  }
  class EqFilterLowShelf extends EqFilterBase {
    computeIIRFilter(freq, q, gain, fs = 96e3) {
      const filter = new Array(20).fill(0);
      const A = Math.pow(10, gain / 40);
      const w0 = 2 * Math.PI * freq / fs;
      const alpha = Math.sin(w0) / 2 * Math.sqrt((A + 1 / A) * (1 / 0.8 - 1) + 2);
      const b0 = A * (A + 1 - (A - 1) * Math.cos(w0) + 2 * Math.sqrt(A) * alpha);
      const b1 = 2 * A * (A - 1 - (A + 1) * Math.cos(w0));
      const b2 = A * (A + 1 - (A - 1) * Math.cos(w0) - 2 * Math.sqrt(A) * alpha);
      const a0 = A + 1 + (A - 1) * Math.cos(w0) + 2 * Math.sqrt(A) * alpha;
      const a1 = -2 * (A - 1 + (A + 1) * Math.cos(w0));
      const a2 = A + 1 + (A - 1) * Math.cos(w0) - 2 * Math.sqrt(A) * alpha;
      const b = [b0 / a0, b1 / a0, b2 / a0];
      const a = [1, a1 / a0, a2 / a0];
      const qu = this.quantizer(a, b);
      let idx = 0;
      for (let i = 0; i < qu.length; i++) {
        filter[idx++] = qu[i] >> 0 & 255;
        filter[idx++] = qu[i] >> 8 & 255;
        filter[idx++] = qu[i] >> 16 & 255;
        filter[idx++] = qu[i] >> 24 & 255;
      }
      return filter;
    }
    // 保持quantizer和intToByte函数不变
    // 定点量化函数（需要根据具体实现补充逻辑）
    // 浮点数量化为整形
    quantizer(a, b) {
      const scale = 30;
      const data = new Array(5).fill(0);
      const qa = new Array(a.length).fill(0);
      const qb = new Array(b.length).fill(0);
      for (let i = 0; i < a.length; i++) {
        qa[i] = Math.round(a[i] * (1 << scale));
      }
      for (let j = 0; j < b.length; j++) {
        qb[j] = Math.round(b[j] * (1 << scale));
      }
      data[0] = qb[0];
      data[1] = qb[1];
      data[2] = qb[2];
      data[3] = -qa[1];
      data[4] = -qa[2];
      return data;
    }
  }
  class EqFilterHighShelf extends EqFilterBase {
    constructor(options = {}) {
      super();
      this.config = { ...this.constructor.config, ...options };
    }
    /**
     * 实现基类要求的IIR滤波器计算
     * @param {number} freq - 中心频率(Hz)
     * @param {number} q - 品质因数
     * @param {number} gain - 增益(dB)
     * @returns {Array} 20字节的滤波器系数数组
     */
    computeIIRFilter(freq, q, gain, fs = 96e3) {
      const safeParams = this._validateParameters(freq, q, gain);
      this.config.sampleRate = fs;
      const { b, a } = this._calculateCoefficients(
        safeParams.freq,
        safeParams.q,
        safeParams.gain
      );
      this._checkStability(b, a);
      const quantized = this.quantizer(a, b);
      return this._generateByteStream(quantized);
    }
    /**
     * 实现基类要求的量化器
     * @param {Array} a - 分母系数 [1, a1, a2]
     * @param {Array} b - 分子系数 [b0, b1, b2]
     * @returns {Int32Array} 量化后的系数数组
     */
    quantizer(a, b) {
      const { scaleBits } = this.config;
      const maxValue = (1 << scaleBits) - 1;
      const coeffs = new Int32Array(5);
      const quantize = (value) => {
        const scaled = Math.round(value * (1 << scaleBits));
        return Math.max(-maxValue, Math.min(maxValue, scaled));
      };
      coeffs[0] = quantize(b[0]);
      coeffs[1] = quantize(b[1]);
      coeffs[2] = quantize(b[2]);
      coeffs[3] = -quantize(a[1]);
      coeffs[4] = -quantize(a[2]);
      return coeffs;
    }
    // ============ 私有方法 ============
    _validateParameters(freq, q, gain) {
      const { minQ, maxQ, maxGain, sampleRate } = this.config;
      const nyquist = sampleRate / 2;
      const safeFreq = Math.max(20, Math.min(freq, nyquist * 0.99));
      const safeQ = Math.max(minQ, Math.min(maxQ, q));
      const limitedGain = Math.max(-maxGain, Math.min(maxGain, gain));
      const safeGain = limitedGain * this.config.headroom;
      if (freq !== safeFreq || q !== safeQ || gain !== limitedGain) {
        console.warn(`参数自动调整: freq=${freq}→${safeFreq}, q=${q}→${safeQ}, gain=${gain}→${safeGain}`);
      }
      return { freq: safeFreq, q: safeQ, gain: safeGain };
    }
    _calculateCoefficients(freq, q, gain) {
      const { sampleRate } = this.config;
      const A = Math.pow(10, Math.abs(gain) / 40);
      const sqrtA = Math.sqrt(A);
      const w0 = 2 * Math.PI * freq / sampleRate;
      const cosW0 = Math.cos(w0);
      const sinW0 = Math.sin(w0);
      const alpha = sinW0 / 2 * Math.sqrt((A + 1 / A) * (1 / q - 1) + 2);
      const b0 = A * (A + 1 + (A - 1) * cosW0 + 2 * sqrtA * alpha);
      const b1 = -2 * A * (A - 1 + (A + 1) * cosW0);
      const b2 = A * (A + 1 + (A - 1) * cosW0 - 2 * sqrtA * alpha);
      const a0 = A + 1 - (A - 1) * cosW0 + 2 * sqrtA * alpha;
      const a1 = 2 * (A - 1 - (A + 1) * cosW0);
      const a2 = A + 1 - (A - 1) * cosW0 - 2 * sqrtA * alpha;
      const sign = gain >= 0 ? 1 : -1;
      return {
        b: [sign * b0 / a0, sign * b1 / a0, sign * b2 / a0],
        a: [1, a1 / a0, a2 / a0]
      };
    }
    _checkStability(b, a) {
      const poleRadius = Math.sqrt(a[2]);
      if (poleRadius >= 0.999) {
        throw new Error(`滤波器不稳定: 极点半径=${poleRadius.toFixed(4)}`);
      }
      const maxCoeff = Math.max(
        ...b.map(Math.abs),
        ...a.slice(1).map(Math.abs)
      );
      if (maxCoeff > 10) {
        console.warn(`大系数警告: b=[${b.map((v) => v.toFixed(4))}], a=[${a.map((v) => v.toFixed(4))}]`);
      }
    }
    _generateByteStream(quantized) {
      const byteStream = new Array(20).fill(0);
      for (let i = 0; i < quantized.length; i++) {
        const offset = i * 4;
        byteStream[offset] = quantized[i] & 255;
        byteStream[offset + 1] = quantized[i] >> 8 & 255;
        byteStream[offset + 2] = quantized[i] >> 16 & 255;
        byteStream[offset + 3] = quantized[i] >> 24 & 255;
      }
      return byteStream;
    }
  }
  // 滤波器配置参数
  __publicField(EqFilterHighShelf, "config", {
    sampleRate: 96e3,
    // 默认采样率
    maxGain: 12,
    // 最大增益(dB)
    minQ: 0.5,
    // Q值下限
    maxQ: 5,
    // Q值上限
    scaleBits: 27,
    // 量化位数
    headroom: 0.85
    // 动态余量系数
  });
  class EqFilterHighPass extends EqFilterBase {
    computeIIRFilter(freq, q, gain, fs = 96e3) {
      const filter = new Array(20).fill(0);
      const w0 = 2 * Math.PI * freq / fs;
      const alpha = Math.sin(w0) / (2 * q);
      const b0 = (1 + Math.cos(w0)) / 2;
      const b1 = -(1 + Math.cos(w0));
      const b2 = (1 + Math.cos(w0)) / 2;
      const a0 = 1 + alpha;
      const a1 = -2 * Math.cos(w0);
      const a2 = 1 - alpha;
      const b = [b0 / a0, b1 / a0, b2 / a0];
      const a = [1, a1 / a0, a2 / a0];
      const qu = this.quantizer(a, b);
      let idx = 0;
      for (let i = 0; i < qu.length; i++) {
        filter[idx++] = qu[i] >> 0 & 255;
        filter[idx++] = qu[i] >> 8 & 255;
        filter[idx++] = qu[i] >> 16 & 255;
        filter[idx++] = qu[i] >> 24 & 255;
      }
      return filter;
    }
    // 定点量化函数（需要根据具体实现补充逻辑）
    // 浮点数量化为整形
    quantizer(a, b) {
      const scale = 30;
      const data = new Array(5).fill(0);
      const qa = new Array(a.length).fill(0);
      const qb = new Array(b.length).fill(0);
      for (let i = 0; i < a.length; i++) {
        qa[i] = Math.round(a[i] * (1 << scale));
      }
      for (let j = 0; j < b.length; j++) {
        qb[j] = Math.round(b[j] * (1 << scale));
      }
      data[0] = qb[0];
      data[1] = qb[1];
      data[2] = qb[2];
      data[3] = -qa[1];
      data[4] = -qa[2];
      return data;
    }
  }
  class ChipCB extends BaseChip$1 {
    constructor(device) {
      super(device);
      this.groupName = "CB";
      this.deviceTypeNo = "CB";
      this.reportId = 75;
      this.device = device;
      this.hidService = new HidService(device);
      this.eqFilterPeak = new EqFilterPeak();
      this.eqFilterLowPass = new EqFilterLowPass();
      this.eqFilterLowShelf = new EqFilterLowShelf();
      this.eqFilterHighPass = new EqFilterHighPass();
      this.eqFilterHighShelf = new EqFilterHighShelf();
    }
    /** 基础功能 */
    getGroupName() {
      return this.groupName;
    }
    //获取设备类型编号
    getDeviceTypeNo() {
      return this.deviceTypeNo;
    }
    getFilterIndexs() {
      return {
        //默认以CB系列序列进行编排，用于曲线图的滤波器选择方案
        "LS": 1,
        // Lowshelf
        "PK": 2,
        // Peak
        "HS": 3,
        // Highshelf
        "LP": 4,
        // Lowpass
        "HP": 5
        // Highpass
      };
    }
    getFilterList() {
      return [{
        disableSchemaNo: [],
        value: 2,
        jc: "PK",
        name: "Peak"
      }, {
        disableSchemaNo: ["11", "13", "20"],
        //禁用方案
        value: 3,
        jc: "HS",
        name: "Highshelf"
      }, {
        disableSchemaNo: [],
        value: 1,
        jc: "LS",
        name: "Lowshelf"
      }, {
        disableSchemaNo: [],
        value: 5,
        jc: "HP",
        name: "Highpass"
      }, {
        disableSchemaNo: [],
        value: 4,
        jc: "LP",
        name: "Lowpass"
      }];
    }
    //是否支持Dac滤波器配置
    getIsSupportDacFilterMode() {
      return true;
    }
    //是否支持降噪
    getIsSupportNoiseReduction() {
      return false;
    }
    /**
     * 处理设备输入报告数据
     * @param {Uint8Array} data - 设备返回的数据
     */
    handleInputReport(data) {
      if (data[1] == 12) {
        const versionBytes = [];
        for (let k = 3; k < 6; k++) {
          const byteData = data[k];
          if (byteData > 0) {
            versionBytes.push(byteData);
          } else {
            break;
          }
        }
        const version = String.fromCharCode.apply(null, versionBytes);
        this.emit(BaseChip$1.EventKeys.ReadDeviceVersion, version);
      }
      if (data[1] == 9) {
        const eqTagId = parseInt(data[35]);
        this.emit(BaseChip$1.EventKeys.ReadEqTagId, eqTagId);
      }
      if (data[1] == 2) {
        let micphoneOffset = parseInt(data[4]);
        if (micphoneOffset > 127) {
          micphoneOffset = micphoneOffset - 256;
        }
        this.emit(BaseChip$1.EventKeys.ReadMicphoneOffset, micphoneOffset);
      }
      if (data[1] == 27) {
        const status = data[3] === 1;
        this.emit(BaseChip$1.EventKeys.ReadENC_Switch, status ? "on" : "off");
      }
      if (data[1] == 17) {
        const index = data[3];
        this.emit(BaseChip$1.EventKeys.ReadFilterIndex, index - 1);
      }
      if (data[1] == 29) {
        const index = data[3];
        this.emit(BaseChip$1.EventKeys.ReadFilterWorkingMode, "" + index);
      }
      if (data[1] == 25) {
        const index = data[3];
        logger.log("滤波器输出增益模式：", index + 1);
        this.emit(BaseChip$1.EventKeys.ReadFilterGainMode, "" + (index + 1));
      }
      if (data[1] == 22) {
        const lr = data[3];
        let v = data[5];
        if (v != 0) {
          v = 256 - v;
          let vs = [0, 0];
          if (lr == 0) {
            vs = [0, v];
          } else {
            vs = [0, -1 * v];
          }
          this.emit(BaseChip$1.EventKeys.ReadDacBalance, vs);
        }
      }
    }
    // 恢复出厂设置
    resetDevice() {
      let pureDatas = [];
      pureDatas.push(new Uint8Array([1, 9, 24, 0, 0, 0, 0, 0, 0, 0, 64, 13, 130, 71, 128, 197, 170, 184, 63, 243, 125, 184, 127, 59, 85, 71, 192, 50, 0, 192, 0, 0, 0, 2, 0, 1]));
      pureDatas.push(new Uint8Array([1, 9, 24, 0, 1, 0, 0, 0, 0, 0, 64, 131, 65, 30, 129, 241, 134, 228, 62, 125, 190, 225, 126, 15, 121, 27, 193, 200, 0, 192, 0, 0, 0, 2, 0, 1]));
      pureDatas.push(new Uint8Array([1, 9, 24, 0, 2, 0, 0, 0, 0, 0, 64, 207, 171, 204, 130, 174, 127, 68, 61, 49, 84, 51, 125, 82, 128, 187, 194, 244, 1, 192, 0, 0, 0, 2, 0, 1]));
      pureDatas.push(new Uint8Array([1, 9, 24, 0, 3, 0, 0, 0, 0, 0, 64, 112, 73, 156, 133, 209, 240, 166, 58, 144, 182, 99, 122, 47, 15, 89, 197, 232, 3, 192, 0, 0, 0, 2, 0, 1]));
      pureDatas.push(new Uint8Array([1, 9, 24, 0, 4, 0, 0, 0, 0, 0, 64, 72, 183, 20, 142, 224, 20, 118, 51, 184, 72, 235, 113, 32, 235, 137, 204, 196, 9, 192, 0, 0, 0, 2, 0, 1]));
      pureDatas.push(new Uint8Array([1, 9, 24, 0, 5, 0, 0, 0, 0, 0, 64, 119, 218, 46, 156, 24, 64, 105, 41, 137, 37, 209, 99, 232, 191, 150, 214, 136, 19, 192, 0, 0, 0, 2, 0, 1]));
      pureDatas.push(new Uint8Array([1, 9, 24, 0, 6, 0, 0, 0, 0, 0, 64, 254, 37, 196, 183, 4, 120, 12, 27, 2, 218, 59, 72, 252, 135, 243, 228, 16, 39, 192, 0, 0, 0, 2, 0, 1]));
      pureDatas.push(new Uint8Array([1, 9, 24, 0, 7, 0, 0, 0, 0, 0, 64, 123, 122, 63, 210, 89, 251, 89, 18, 133, 133, 192, 45, 167, 4, 166, 237, 152, 58, 192, 0, 0, 0, 2, 0, 1]));
      pureDatas.forEach((item) => {
        this.deviceWrite(item);
      });
      this.deviceWrite(new Uint8Array([1, 5, 0]));
      this.deviceWrite(new Uint8Array([1, 23, 0]));
      this.refereshToMemery();
      this.refereshToFlash();
      this.setDacOffset(0);
    }
    // 读取固件版本
    readDeviceVersion() {
      logger.log("开始读取固件版本");
      this.deviceRead(new Uint8Array([128, 12]));
    }
    // 获取设备相关信息
    getDeviceInfo() {
    }
    // 将数据刷新到寄存器（缓存）
    refereshToMemery() {
      logger.log("将数据刷新到寄存器（缓存）");
      this.deviceWrite(new Uint8Array([1, 10, 4, 0, 0, 255, 255]));
    }
    // 刷新缓存到Flash
    refereshToFlash() {
      logger.log("将数据刷新到Flash");
      this.deviceWrite(new Uint8Array([1, 1, 0]));
    }
    // 封装读取向设备读取数据函数
    async deviceRead(data) {
      if (this.device) {
        await this.hidService.sendReport(this.reportId, data);
      }
    }
    // 封装读取向设备写入数据函数
    async deviceWrite(data) {
      if (this.device) {
        await this.hidService.sendReport(this.reportId, data);
        return true;
      }
    }
    /** EQ相关 */
    // 读取EQ TagId
    readEqTagId() {
      logger.log("读取Dac EQ TagId");
      this.deviceRead(new Uint8Array([128, 9, 0]));
    }
    // 读取设备EQ的全局音量 offset
    readEqOffset() {
      logger.log("读取设备EQ的全局增益（音量）");
      throw new Error("readEqOffset() not implemented");
    }
    // 设置DAC增益Offset
    setDacOffset(size) {
      logger.log("设置DAC增益 - size: ", size);
      this.deviceWrite(new Uint8Array([1, 3, 2, 0, size]));
    }
    // 写入EQ数据到寄存器(试听)
    setEqInfo(eq) {
      logger.log("写入EQ数据到寄存器(试听) - eq: ", eq);
      const resultData = this.getEqBytesFromEQParam(eq.tag, eq);
      if (resultData) {
        for (let i = 0; i < resultData.length; i++) {
          const eqData = resultData[i];
          this.deviceWrite(eqData);
        }
        this.refereshToMemery();
      }
    }
    // 写入EQ数据到寄存器，并刷入Flash
    saveEqInfo(eq) {
      logger.log("写入EQ数据到寄存器，并刷入Flash - eq: ", eq);
      this.setEqInfo(eq);
      setTimeout(() => {
        this.refereshToFlash();
      }, 1e3);
    }
    // 从源EQ参数计算出二进制CB协议所使用的字节数组数据，用于写入设备
    // EQ数据转换（将界面的EQ参数转换成各芯片可写入的数据）
    getEqBytesFromEQParam(id, eq) {
      let resultData = [];
      if (eq && eq.freqs && eq.qs && eq.gains) {
        const freqs = eq.freqs;
        const qs = eq.qs;
        const gains = eq.gains;
        for (let i = 0; i < eq.freqs.length; i++) {
          const freq = freqs[i];
          const q = qs[i];
          const gain = gains[i];
          let filters = [];
          const filterType = eq.filterTypes[i];
          switch (filterType) {
            case 1:
              filters = this.eqFilterLowShelf.computeIIRFilter(freq, q, gain);
              break;
            case 2:
              filters = this.eqFilterPeak.computeIIRFilter(freq, q, gain);
              break;
            case 3:
              filters = this.eqFilterHighShelf.computeIIRFilter(freq, q, gain);
              break;
            case 4:
              filters = this.eqFilterLowPass.computeIIRFilter(freq, q, gain);
              break;
            case 5:
              filters = this.eqFilterHighPass.computeIIRFilter(freq, q, gain);
              break;
          }
          const eqData = new Uint8Array(36);
          eqData[0] = 1;
          eqData[1] = 9;
          eqData[2] = 4 + filters.length;
          eqData[3] = 0;
          eqData[4] = 0 + i & 255;
          eqData[5] = 0;
          eqData[6] = 0;
          for (let i2 = 0; i2 < filters.length; i2++) {
            eqData[7 + i2] = filters[i2];
          }
          const quantQ = Math.round(q * 256);
          const quantGain = Math.round(gain * 256);
          eqData[27] = this.intToByte(freq, 0);
          eqData[28] = this.intToByte(freq, 1);
          eqData[29] = this.intToByte(quantQ, 0);
          eqData[30] = this.intToByte(quantQ, 1);
          eqData[31] = this.intToByte(quantGain, 0);
          eqData[32] = this.intToByte(quantGain, 1);
          eqData[33] = filterType;
          eqData[34] = eq.offset;
          eqData[35] = id;
          resultData.push(eqData);
        }
      }
      return resultData;
    }
    /** 麦克风相关 */
    // 读取麦克风增益（offset）
    readMicphoneOffset() {
      logger.log("读取麦克风增益（offset）");
      this.deviceRead(new Uint8Array([128, 2, 0]));
    }
    // 读取降噪开关状态
    readENC_Switch() {
      logger.log("读取降噪开关状态");
      this.deviceRead(new Uint8Array([128, 27, 0]));
    }
    // 设置麦克风增益（offset）
    setMicphoneOffset(offset) {
      logger.log("设置麦克风增益（offset） - offset: ", offset);
      this.deviceWrite(new Uint8Array([1, 2, 2, 128, offset]));
    }
    // 保存设置的增益数据
    saveMicphoneOffset() {
      logger.log("保存设置的增益数据");
      this.refereshToFlash();
    }
    setDenoiseSwitch(flag) {
      logger.log("设置降噪开关状态 - flag: ", flag);
      if (flag === "on") {
        const enableNoiseBytes = new Uint8Array([1, 27, 1, 1]);
        this.deviceWrite(enableNoiseBytes);
        this.refereshToFlash();
      } else if (flag === "off") {
        const enableNoiseBytes = new Uint8Array([1, 27, 1, 0]);
        this.deviceWrite(enableNoiseBytes);
        this.refereshToFlash();
      }
    }
    /** 滤波器相关 */
    // 读取设备中滤波器相关信息
    readFilterInfo() {
      logger.log("读取设备中滤波器相关信息");
      throw new Error("readFilterInfo() not implemented");
    }
    // 读取滤波器ID(下标、序号)
    readFilterIndex() {
      logger.log("读取滤波器ID(下标、序号)");
      this.deviceRead(new Uint8Array([128, 17]));
    }
    // 读取滤波器工作模式
    readFilterWorkingMode() {
      logger.log("读取滤波器工作模式");
      this.deviceRead(new Uint8Array([128, 29]));
    }
    // 读取滤波器输出增益模式
    readFilterOutMode() {
      logger.log("读取滤波器输出增益模式");
      this.deviceRead(new Uint8Array([128, 25]));
    }
    // 读取DAC声道平衡
    readDacBalance() {
      logger.log("读取DAC声道平衡");
      this.deviceRead(new Uint8Array([128, 22, 2, 0, 0]));
      this.deviceRead(new Uint8Array([128, 22, 2, 1, 0]));
    }
    //选择和设置滤波器
    selectFilter(filterCode) {
      logger.log("选择和设置滤波器 - filterCode: ", filterCode);
      let mode = 1;
      switch (filterCode) {
        case "FAST-LL":
          mode = 1;
          break;
        case "FAST-PC":
          mode = 2;
          break;
        case "SLOW-LL":
          mode = 3;
          break;
        case "SLOW-PC":
          mode = 4;
          break;
        case "NON-OS":
          mode = 5;
          break;
      }
      const modeBytes = new Uint8Array([1, 17, 1, mode]);
      this.deviceWrite(modeBytes);
    }
    //设置滤波器工作模式
    setDacWorkMode(mode) {
      logger.log("设置滤波器工作模式 - mode: ", mode);
      let modeData = 1;
      if (mode == "0") {
        modeData = 0;
      } else if (mode == "1") {
        modeData = 1;
      }
      const modeBytes = new Uint8Array([1, 29, 1, modeData]);
      this.deviceWrite(modeBytes);
    }
    // 设置滤波器输出增益模式
    setDacOffsetMode(mode) {
      logger.log("设置滤波器输出增益模式 - mode: ", mode);
      if (!mode || (mode < 1 || mode > 3)) {
        return;
      }
      const modeData = mode - 1;
      const modeBytes = new Uint8Array([1, 25, 1, modeData]);
      this.deviceWrite(modeBytes);
    }
    //DAC声道平衡
    setDacBalance(left, right) {
      logger.log("设置DAC声道平衡 - left: ", left, "right: ", right);
      if (left > 0) {
        const r = -1 * left;
        const balanceBytesR = new Uint8Array([1, 22, 4, 1, 0, r, 0]);
        this.deviceWrite(balanceBytesR);
        const balanceBytesL = new Uint8Array([1, 22, 4, 0, 0, 0, 0]);
        this.deviceWrite(balanceBytesL);
      } else if (right > 0) {
        const balanceBytesR = new Uint8Array([1, 22, 4, 1, 0, 0, 0]);
        this.deviceWrite(balanceBytesR);
        const l = -1 * right;
        const balanceBytesL = new Uint8Array([1, 22, 4, 0, 0, l, 0]);
        this.deviceWrite(balanceBytesL);
      } else if (left == 0 && right == 0) {
        const balanceBytesR = new Uint8Array([1, 22, 4, 0, 1, 0, 0]);
        this.deviceWrite(balanceBytesR);
        const balanceBytesL = new Uint8Array([1, 22, 4, 0, 0, 0, 0]);
        this.deviceWrite(balanceBytesL);
      }
    }
    intToByte(eqData, position) {
      return eqData >> position * 8 & 255;
    }
  }
  class ChipCB1300D extends ChipCB {
    constructor(device) {
      super(device);
      this.groupName = "CB";
      this.deviceTypeNo = "CB1300D";
      this.reportId = 75;
      this.device = device;
      this.hidService = new HidService(device);
      this.eqFilterPeak = new EqFilterPeak();
      this.eqFilterLowPass = new EqFilterLowPass();
      this.eqFilterLowShelf = new EqFilterLowShelf();
      this.eqFilterHighPass = new EqFilterHighPass();
      this.eqFilterHighShelf = new EqFilterHighShelf();
      this.eventMap = /* @__PURE__ */ new Map();
    }
    /** 基础功能 */
    getGroupName() {
      return this.groupName;
    }
    //获取设备类型编号
    getDeviceTypeNo() {
      return this.deviceTypeNo;
    }
    getFilterIndexs() {
      return {
        //默认以CB系列序列进行编排，用于曲线图的滤波器选择方案
        "LS": 1,
        // Lowshelf
        "PK": 2,
        // Peak
        "HS": 3,
        // Highshelf
        "LP": 4,
        // Lowpass
        "HP": 5
        // Highpass
      };
    }
    getFilterList() {
      return [{
        disableSchemaNo: [],
        value: 2,
        jc: "PK",
        name: "Peak"
      }, {
        disableSchemaNo: ["11", "13", "20", "21"],
        //禁用方案
        value: 3,
        jc: "HS",
        name: "Highshelf"
      }, {
        disableSchemaNo: [],
        value: 1,
        jc: "LS",
        name: "Lowshelf"
      }, {
        disableSchemaNo: [],
        value: 5,
        jc: "HP",
        name: "Highpass"
      }, {
        disableSchemaNo: [],
        value: 4,
        jc: "LP",
        name: "Lowpass"
      }];
    }
    //是否支持Dac滤波器配置
    getIsSupportDacFilterMode() {
      return true;
    }
    //是否支持降噪
    getIsSupportNoiseReduction() {
      return false;
    }
    /**
     * 获取芯片默认的EQ段数
     * CB1300D 使用10段EQ
     * @returns {number} EQ段数
     */
    getDefaultEqSegments() {
      return 10;
    }
    /**
     * 处理设备输入报告数据
     * @param {Uint8Array} data - 设备返回的数据
     */
    handleInputReport(data) {
      super.handleInputReport(data);
      logger.log("读取数据", data);
      if (data[1] == 218) {
        logger.log("读取ADC EQ tagId", data);
        const adcEqTagId = parseInt(data[35]);
        this.emit(BaseChip$1.EventKeys.ReadAdcEqTagId, adcEqTagId);
      }
      if (data[1] == 34) {
        const v = data[3];
        this.emit(BaseChip$1.EventKeys.CB1300D.Read3DModeSwitch, v);
      }
      if (data[1] == 211) {
        const v = data[3];
        this.emit(BaseChip$1.EventKeys.CB1300D.ReadModeValue, v);
      }
      if (data[1] == 36) {
        const v = data[3];
        this.emit(BaseChip$1.EventKeys.CB1300D.ReadModeGain, v);
      }
      if (data[1] == 38) {
        const s = data[3];
        const v = data[4];
        this.emit(BaseChip$1.EventKeys.CB1300D.ReadReverbSwitch, s);
        this.emit(BaseChip$1.EventKeys.CB1300D.ReadReverbValue, v);
      }
      if (data[1] == 37) {
        logger.log("3D声源角度：", data);
        const index = data[3];
        const angleV1 = data[4];
        const angleV2 = data[5];
        let angle = angleV2 << 8 | angleV1;
        this.emit(BaseChip$1.EventKeys.CB1300D.ReadSoundSourceAngle, index, angle);
      }
    }
    // 恢复出厂设置
    resetDevice() {
      let pureDatas = [];
      pureDatas.push(new Uint8Array([1, 9, 24, 0, 0, 0, 0, 0, 0, 0, 64, 13, 130, 71, 128, 197, 170, 184, 63, 243, 125, 184, 127, 59, 85, 71, 192, 50, 0, 192, 0, 0, 0, 2, 0, 1]));
      pureDatas.push(new Uint8Array([1, 9, 24, 0, 1, 0, 0, 0, 0, 0, 64, 131, 65, 30, 129, 241, 134, 228, 62, 125, 190, 225, 126, 15, 121, 27, 193, 200, 0, 192, 0, 0, 0, 2, 0, 1]));
      pureDatas.push(new Uint8Array([1, 9, 24, 0, 2, 0, 0, 0, 0, 0, 64, 207, 171, 204, 130, 174, 127, 68, 61, 49, 84, 51, 125, 82, 128, 187, 194, 244, 1, 192, 0, 0, 0, 2, 0, 1]));
      pureDatas.push(new Uint8Array([1, 9, 24, 0, 3, 0, 0, 0, 0, 0, 64, 112, 73, 156, 133, 209, 240, 166, 58, 144, 182, 99, 122, 47, 15, 89, 197, 232, 3, 192, 0, 0, 0, 2, 0, 1]));
      pureDatas.push(new Uint8Array([1, 9, 24, 0, 4, 0, 0, 0, 0, 0, 64, 72, 183, 20, 142, 224, 20, 118, 51, 184, 72, 235, 113, 32, 235, 137, 204, 196, 9, 192, 0, 0, 0, 2, 0, 1]));
      pureDatas.push(new Uint8Array([1, 9, 24, 0, 5, 0, 0, 0, 0, 0, 64, 119, 218, 46, 156, 24, 64, 105, 41, 137, 37, 209, 99, 232, 191, 150, 214, 136, 19, 192, 0, 0, 0, 2, 0, 1]));
      pureDatas.push(new Uint8Array([1, 9, 24, 0, 6, 0, 0, 0, 0, 0, 64, 254, 37, 196, 183, 4, 120, 12, 27, 2, 218, 59, 72, 252, 135, 243, 228, 16, 39, 192, 0, 0, 0, 2, 0, 1]));
      pureDatas.push(new Uint8Array([1, 9, 24, 0, 7, 0, 0, 0, 0, 0, 64, 123, 122, 63, 210, 89, 251, 89, 18, 133, 133, 192, 45, 167, 4, 166, 237, 152, 58, 192, 0, 0, 0, 2, 0, 1]));
      pureDatas.forEach((item) => {
        this.deviceWrite(item);
      });
      this.deviceWrite(new Uint8Array([1, 5, 0]));
      this.deviceWrite(new Uint8Array([1, 23, 0]));
      this.refereshToMemery();
      this.refereshToFlash();
      this.setDacOffset(0);
      this.setAdcOffset(0);
    }
    // 读取固件版本
    readDeviceVersion() {
      this.deviceRead(new Uint8Array([128, 12]));
    }
    // 获取设备相关信息
    getDeviceInfo() {
    }
    // 将数据刷新到寄存器（缓存）
    refereshToMemery() {
      this.deviceWrite(new Uint8Array([1, 10, 4, 0, 0, 255, 255]));
    }
    // 刷新缓存到Flash
    refereshToFlash() {
      logger.log("刷新缓存到Flash");
      this.deviceWrite(new Uint8Array([1, 1, 0]));
    }
    // 封装读取向设备读取数据函数
    async deviceRead(data) {
      if (this.device) {
        await this.hidService.sendReport(this.reportId, data);
      }
    }
    // 封装读取向设备写入数据函数
    async deviceWrite(data) {
      if (this.device) {
        await this.hidService.sendReport(this.reportId, data);
        return true;
      }
    }
    /** EQ相关 */
    // 读取EQ TagId
    readEqTagId() {
      this.deviceRead(new Uint8Array([128, 9, 0]));
    }
    readAdcEqTagId() {
      console.log("读取ADC EQ tagId");
      this.deviceRead(new Uint8Array([128, 218, 0]));
    }
    // 读取设备EQ的全局音量 offset
    readEqOffset() {
      throw new Error("readEqOffset() not implemented");
    }
    // 设置DAC增益Offset
    setDacOffset(size) {
      logger.log("设置DAC增益", size);
      this.deviceWrite(new Uint8Array([1, 3, 2, 0, size]));
    }
    // 设置ADC增益Offset
    setAdcOffset(size) {
      logger.log("设置ADC增益", size);
      let value;
      if (size === 15) {
        value = 32767;
      } else if (size === -15) {
        value = 32769;
      } else {
        const maxSize = 15;
        const ratio = 32767 / maxSize;
        let signedValue = Math.round(size * ratio);
        signedValue = Math.max(-32767, Math.min(32767, signedValue));
        value = signedValue < 0 ? signedValue + 65536 : signedValue;
      }
      const lowByte = value & 255;
      const highByte = value >> 8 & 255;
      logger.log("ADC增益offset - size:", size, "值:", value, "高字节:", highByte, "低字节:", lowByte);
      const byteSequence = new Uint8Array([1, 2, 2, lowByte, highByte]);
      this.deviceWrite(byteSequence);
      const formatStr = Array.from(byteSequence).map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
      logger.log("发送的字节序列:", "4b " + formatStr);
    }
    // 写入EQ数据到寄存器(试听)
    setEqInfo(eq) {
      logger.log("写入EQ数据到寄存器(试听)");
      const resultData = this.getEqBytesFromEQParam(eq.tag, eq);
      if (resultData) {
        for (let i = 0; i < resultData.length; i++) {
          const eqData = resultData[i];
          this.deviceWrite(eqData);
        }
        this.refereshToMemery();
      }
    }
    // 写入ADC EQ数据到寄存器(试听)
    setAdcEqInfo(eq) {
      logger.log("写入ADC EQ数据到寄存器(试听)");
      const resultData = this.getAdcEqBytesFromEQParam(eq.tag, eq);
      if (resultData) {
        for (let i = 0; i < resultData.length; i++) {
          const eqData = resultData[i];
          this.deviceWrite(eqData);
        }
        this.refereshToMemery();
      }
    }
    // 写入EQ数据到寄存器，并刷入Flash
    saveEqInfo(eq) {
      this.setEqInfo(eq);
      setTimeout(() => {
        this.refereshToFlash();
      }, 1e3);
    }
    // 写入ADC EQ数据到寄存器，并刷入Flash
    saveAdcEqInfo(eq) {
      this.setAdcEqInfo(eq);
      setTimeout(() => {
        this.refereshToFlash();
      }, 1e3);
    }
    // 从源EQ参数计算出二进制CB协议所使用的字节数组数据，用于写入设备
    // EQ数据转换（将界面的EQ参数转换成各芯片可写入的数据）
    getEqBytesFromEQParam(id, eq) {
      let resultData = [];
      if (eq && eq.freqs && eq.qs && eq.gains) {
        const freqs = eq.freqs;
        const qs = eq.qs;
        const gains = eq.gains;
        console.log("getEqBytesFromEQParam-----------eq.freqs.length===", eq.freqs.length);
        for (let i = 0; i < eq.freqs.length; i++) {
          const freq = freqs[i];
          const q = qs[i];
          const gain = gains[i];
          let filters = [];
          const filterType = eq.filterTypes[i];
          switch (filterType) {
            case 1:
              filters = this.eqFilterLowShelf.computeIIRFilter(freq, q, gain, 48e3);
              break;
            case 2:
              filters = this.eqFilterPeak.computeIIRFilter(freq, q, gain, 48e3);
              break;
            case 3:
              filters = this.eqFilterHighShelf.computeIIRFilter(freq, q, gain, 48e3);
              break;
            case 4:
              filters = this.eqFilterLowPass.computeIIRFilter(freq, q, gain, 48e3);
              break;
            case 5:
              filters = this.eqFilterHighPass.computeIIRFilter(freq, q, gain, 48e3);
              break;
          }
          console.log("filters---------------", filters.length);
          const eqData = new Uint8Array(36);
          eqData[0] = 1;
          eqData[1] = 9;
          eqData[2] = 4 + filters.length;
          eqData[3] = 0;
          eqData[4] = 0 + i & 255;
          eqData[5] = 0;
          eqData[6] = 0;
          for (let i2 = 0; i2 < filters.length; i2++) {
            eqData[7 + i2] = filters[i2];
          }
          const quantQ = Math.round(q * 256);
          const quantGain = Math.round(gain * 256);
          eqData[27] = this.intToByte(freq, 0);
          eqData[28] = this.intToByte(freq, 1);
          eqData[29] = this.intToByte(quantQ, 0);
          eqData[30] = this.intToByte(quantQ, 1);
          eqData[31] = this.intToByte(quantGain, 0);
          eqData[32] = this.intToByte(quantGain, 1);
          eqData[33] = filterType;
          eqData[34] = eq.offset;
          eqData[35] = id;
          resultData.push(eqData);
        }
      }
      return resultData;
    }
    // 从源EQ参数计算出二进制CB协议所使用的字节数组数据，用于写入设备（ADC EQ版本）
    // EQ数据转换（将界面的EQ参数转换成各芯片可写入的ADC EQ数据）
    getAdcEqBytesFromEQParam(id, eq) {
      let resultData = [];
      if (eq && eq.freqs && eq.qs && eq.gains) {
        const freqs = eq.freqs;
        const qs = eq.qs;
        const gains = eq.gains;
        console.log("getAdcEqBytesFromEQParam-----------eq.freqs.length===", eq);
        for (let i = 0; i < eq.freqs.length; i++) {
          const freq = freqs[i];
          const q = qs[i];
          const gain = gains[i];
          let filters = [];
          const filterType = eq.filterTypes[i];
          switch (filterType) {
            case 1:
              filters = this.eqFilterLowShelf.computeIIRFilter(freq, q, gain, 48e3);
              break;
            case 2:
              filters = this.eqFilterPeak.computeIIRFilter(freq, q, gain, 48e3);
              break;
            case 3:
              filters = this.eqFilterHighShelf.computeIIRFilter(freq, q, gain, 48e3);
              break;
            case 4:
              filters = this.eqFilterLowPass.computeIIRFilter(freq, q, gain, 48e3);
              break;
            case 5:
              filters = this.eqFilterHighPass.computeIIRFilter(freq, q, gain, 48e3);
              break;
          }
          console.log("filters---------------", filters.length);
          const eqData = new Uint8Array(36);
          eqData[0] = 1;
          eqData[1] = 218;
          eqData[2] = 4 + filters.length;
          eqData[3] = 0;
          eqData[4] = 0 + i & 255;
          eqData[5] = 0;
          eqData[6] = 0;
          for (let i2 = 0; i2 < filters.length; i2++) {
            eqData[7 + i2] = filters[i2];
          }
          const quantQ = Math.round(q * 256);
          const quantGain = Math.round(gain * 256);
          eqData[27] = this.intToByte(freq, 0);
          eqData[28] = this.intToByte(freq, 1);
          eqData[29] = this.intToByte(quantQ, 0);
          eqData[30] = this.intToByte(quantQ, 1);
          eqData[31] = this.intToByte(quantGain, 0);
          eqData[32] = this.intToByte(quantGain, 1);
          eqData[33] = filterType;
          eqData[34] = eq.offset;
          eqData[35] = id;
          resultData.push(eqData);
        }
      }
      return resultData;
    }
    /** 麦克风相关 */
    // 读取麦克风增益（offset）
    readMicphoneOffset() {
      this.deviceRead(new Uint8Array([128, 2, 0]));
    }
    // 读取降噪开关状态
    readENC_Switch() {
      this.deviceRead(new Uint8Array([128, 27, 0]));
    }
    // 设置麦克风增益（offset）
    setMicphoneOffset(offset) {
      logger.log("设置麦克风增益", offset);
      let value;
      if (offset === 15) {
        value = 32767;
      } else if (offset === -15) {
        value = 32769;
      } else {
        const maxSize = 15;
        const ratio = 32767 / maxSize;
        let signedValue = Math.round(offset * ratio);
        signedValue = Math.max(-32767, Math.min(32767, signedValue));
        value = signedValue < 0 ? signedValue + 65536 : signedValue;
      }
      const lowByte = value & 255;
      const highByte = value >> 8 & 255;
      logger.log("麦克风增益offset - size:", offset, "值:", value, "高字节:", highByte, "低字节:", lowByte);
      const byteSequence = new Uint8Array([1, 2, 2, lowByte, highByte]);
      this.deviceWrite(byteSequence);
      const formatStr = Array.from(byteSequence).map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
      logger.log("发送的字节序列:", "4b " + formatStr);
    }
    // 保存设置的增益数据
    saveMicphoneOffset() {
      this.refereshToFlash();
    }
    setDenoiseSwitch(flag) {
      if (flag === "on") {
        const enableNoiseBytes = new Uint8Array([1, 27, 1, 1]);
        this.deviceWrite(enableNoiseBytes);
        this.refereshToFlash();
      } else if (flag === "off") {
        const enableNoiseBytes = new Uint8Array([1, 27, 1, 0]);
        this.deviceWrite(enableNoiseBytes);
        this.refereshToFlash();
      }
    }
    setAdcInEarMonitorsListenSwitch(flag) {
      console.log("setAdcInEarMonitorsListenSwitch()", flag);
      if (flag) {
        this.deviceWrite(new Uint8Array([1, 96, 1, 1]));
      } else {
        this.deviceWrite(new Uint8Array([1, 96, 1, 0]));
      }
    }
    /** 滤波器相关 */
    // 读取设备中滤波器相关信息
    readFilterInfo() {
      throw new Error("readFilterInfo() not implemented");
    }
    // 读取滤波器ID(下标、序号)
    readFilterIndex() {
      this.deviceRead(new Uint8Array([128, 17]));
    }
    // 读取滤波器工作模式
    readFilterWorkingMode() {
      this.deviceRead(new Uint8Array([128, 29]));
    }
    // 读取滤波器输出增益模式
    readFilterOutMode() {
      this.deviceRead(new Uint8Array([128, 25]));
    }
    // 读取DAC声道平衡
    readDacBalance() {
      this.deviceRead(new Uint8Array([128, 22, 2, 0, 0]));
      this.deviceRead(new Uint8Array([128, 22, 2, 1, 0]));
    }
    //选择和设置滤波器
    selectFilter(filterCode) {
      let mode = 1;
      switch (filterCode) {
        case "FAST-LL":
          mode = 1;
          break;
        case "FAST-PC":
          mode = 2;
          break;
        case "SLOW-LL":
          mode = 3;
          break;
        case "SLOW-PC":
          mode = 4;
          break;
        case "NON-OS":
          mode = 5;
          break;
      }
      const modeBytes = new Uint8Array([1, 17, 1, mode]);
      this.deviceWrite(modeBytes);
    }
    //设置滤波器工作模式
    setDacWorkMode(mode) {
      let modeData = 1;
      if (mode == "0") {
        modeData = 0;
      } else if (mode == "1") {
        modeData = 1;
      }
      const modeBytes = new Uint8Array([1, 29, 1, modeData]);
      this.deviceWrite(modeBytes);
    }
    // 设置滤波器输出增益模式
    setDacOffsetMode(mode) {
      if (!mode || (mode < 1 || mode > 3)) {
        return;
      }
      const modeData = mode - 1;
      const modeBytes = new Uint8Array([1, 25, 1, modeData]);
      this.deviceWrite(modeBytes);
    }
    //DAC声道平衡
    setDacBalance(left, right) {
      if (left > 0) {
        const r = -1 * left;
        const balanceBytesR = new Uint8Array([1, 22, 4, 1, 0, r, 0]);
        this.deviceWrite(balanceBytesR);
        const balanceBytesL = new Uint8Array([1, 22, 4, 0, 0, 0, 0]);
        this.deviceWrite(balanceBytesL);
      } else if (right > 0) {
        const balanceBytesR = new Uint8Array([1, 22, 4, 1, 0, 0, 0]);
        this.deviceWrite(balanceBytesR);
        const l = -1 * right;
        const balanceBytesL = new Uint8Array([1, 22, 4, 0, 0, l, 0]);
        this.deviceWrite(balanceBytesL);
      } else if (left == 0 && right == 0) {
        const balanceBytesR = new Uint8Array([1, 22, 4, 0, 1, 0, 0]);
        this.deviceWrite(balanceBytesR);
        const balanceBytesL = new Uint8Array([1, 22, 4, 0, 0, 0, 0]);
        this.deviceWrite(balanceBytesL);
      }
    }
    intToByte(eqData, position) {
      return eqData >> position * 8 & 255;
    }
    /** 新增7.1虚拟音效功能 */
    // 读取3D模式开关（0、关闭 1、打开）
    read3DModeSwitch() {
      this.deviceRead(new Uint8Array([128, 34, 0]));
    }
    // 读取3D模式参数（0、GAME 1、MUSIC 2、MOVIE）
    readSoundSource() {
      this.deviceRead(new Uint8Array([128, 211, 0]));
    }
    // 读取3D模式增益（-4 - 0）
    read3DGain() {
      this.deviceRead(new Uint8Array([128, 36, 0]));
    }
    // 读取混响（2个参数：0：ON开，1：OFF关，0-9：混响等级）
    readReverb() {
      this.deviceRead(new Uint8Array([128, 38, 0]));
    }
    // 读取声源音效（0~359度）
    async readSoundSourceAngle() {
      this.deviceRead(new Uint8Array([128, 37, 1, 0]));
      await this.delay();
      this.deviceRead(new Uint8Array([128, 37, 1, 1]));
      await this.delay();
      this.deviceRead(new Uint8Array([128, 37, 1, 2]));
      await this.delay();
      this.deviceRead(new Uint8Array([128, 37, 1, 3]));
      await this.delay();
      this.deviceRead(new Uint8Array([128, 37, 1, 4]));
      await this.delay();
      this.deviceRead(new Uint8Array([128, 37, 1, 5]));
      await this.delay();
      this.deviceRead(new Uint8Array([128, 37, 1, 6]));
      await this.delay();
      this.deviceRead(new Uint8Array([128, 37, 1, 7]));
    }
    //延迟
    async delay(ms = 80) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    // 3D模式开关设置（0、关闭 1、打开）
    set3DModeSwitch(flag) {
      if (flag != 0 && flag != 1) {
        return;
      }
      this.deviceWrite(new Uint8Array([1, 34, 1, flag]));
    }
    // 3D模式参数配置（0、GAME 1、MUSIC 2、MOVIE）
    setModeValue(mode) {
      if (mode < 0 || mode > 2) {
        return;
      }
      this.deviceWrite(new Uint8Array([1, 211, 1, mode]));
    }
    // 3D模式增益设置（-4 - 0）
    set3DGain(gain) {
      if (gain < -4 || gain > 0) {
        return;
      }
      this.deviceWrite(new Uint8Array([1, 36, 1, gain]));
    }
    // 配置混响（2个参数：0：ON开，1：OFF关，0-9：混响等级）
    setReverb(flag, level) {
      if (flag != 0 && flag != 1) {
        return;
      }
      if (level < 0 || level > 9) {
        return;
      }
      this.deviceWrite(new Uint8Array([1, 38, 1, flag, level]));
    }
    // 配置声源音效（0~359度）
    setSoundSourceAngle(index, angle) {
      if (index < 0 || index > 7) {
        return;
      }
      if (angle < 0 || angle > 359) {
        return;
      }
      const angleByte1 = angle & 255;
      const angleByte2 = angle >> 8 & 255;
      this.deviceWrite(new Uint8Array([1, 37, 3, index, angleByte1, angleByte2]));
    }
    async resetParams() {
      this.setReverb(0, 0);
      await this.delay();
      this.set3DModeSwitch(0);
      await this.delay();
      this.set3DGain(-2);
      await this.delay();
      this.setModeValue(0);
      await this.delay();
      this.setSoundSourceAngle(0, 315);
      await this.delay();
      this.setSoundSourceAngle(1, 45);
      await this.delay();
      this.setSoundSourceAngle(2, 0);
      await this.delay();
      this.setSoundSourceAngle(3, 0);
      await this.delay();
      this.setSoundSourceAngle(4, 225);
      await this.delay();
      this.setSoundSourceAngle(5, 135);
      await this.delay();
      this.setSoundSourceAngle(6, 270);
      await this.delay();
      this.setSoundSourceAngle(7, 90);
      await this.delay();
      this.read3DModeSwitch();
      await this.delay();
      this.readSoundSource();
      await this.delay();
      this.read3DGain();
      await this.delay();
      this.readReverb();
      await this.delay();
      this.readSoundSourceAngle();
    }
  }
  class ChipKT extends BaseChip$1 {
    constructor(device) {
      super(device);
      this.groupName = "KT";
      this.deviceTypeNo = "KT";
      this.utilName = "KT";
      this.device = device;
    }
    /** 基础功能 */
    getGroupName() {
      return this.groupName;
    }
    //获取设备类型编号
    getDeviceTypeNo() {
      return this.deviceTypeNo;
    }
    getFilterIndexs() {
      return {
        //用于曲线图的滤波器排序和下标值选择方案，数值对应写入硬件的值
        "PK": 0,
        //Peak
        "LP": 1,
        //Lowpass
        "HP": 2,
        // Highpass
        "LS": 3,
        // Lowshelf
        "HS": 4
        // Highshelf
      };
    }
    getFilterList() {
      return [
        {
          disableSchemaNo: [],
          value: 0,
          jc: "PK",
          name: "Peak"
        },
        {
          disableSchemaNo: ["17"],
          //禁用方案
          value: 4,
          jc: "HS",
          name: "Highshelf"
        },
        {
          disableSchemaNo: [],
          value: 3,
          jc: "LS",
          name: "Lowshelf"
        },
        {
          disableSchemaNo: [],
          value: 2,
          jc: "HP",
          name: "Highpass"
        },
        {
          disableSchemaNo: [],
          value: 1,
          jc: "LP",
          name: "Lowpass"
        }
      ];
    }
    getIsSupportDacFilterMode() {
      return true;
    }
    //是否支持降噪
    getIsSupportNoiseReduction() {
      return false;
    }
    // 恢复出厂设置
    resetDevice() {
      throw new Error("resetDevice() not implemented");
    }
    // 读取固件版本
    readDeviceVersion() {
      throw new Error("readDeviceVersion() not implemented");
    }
    // 获取设备相关信息
    getDeviceInfo() {
      throw new Error("getDeviceInfo() not implemented");
    }
    // 刷新缓存到Flash
    refereshToFlash() {
      throw new Error("refereshToFlash() not implemented");
    }
    // 读取数据
    deviceRead() {
      throw new Error("readData() not implemented");
    }
    // 写入数据
    deviceWrite() {
      throw new Error("writeData() not implemented");
    }
    /** EQ相关 */
    // 读取EQ TagId
    readEqTagId() {
      throw new Error("readEqTagId() not implemented");
    }
    // 读取设备EQ的全局音量 offset
    readEqOffset() {
      throw new Error("readEqOffset() not implemented");
    }
    // 设置DAC增益Offset
    setDacOffset(offset) {
      throw new Error("setDacOffset() not implemented");
    }
    // 写入EQ数据到寄存器
    setEqInfo(eq) {
      throw new Error("setEqInfo() not implemented");
    }
    // 写入EQ数据到寄存器，并刷入Flash
    saveEqInfo(eq) {
      throw new Error("saveEqInfo() not implemented");
    }
    // EQ数据转换（将界面的EQ参数转换成各芯片可写入的数据）
    getEqBytesFromEQParam() {
      throw new Error("getEqBytesFromEQParam() not implemented");
    }
    /** 麦克风相关 */
    // 读取麦克风增益（offset）
    readMicphoneOffset() {
      throw new Error("readMicphoneOffset() not implemented");
    }
    // 设置麦克风增益（offset）
    setMicphoneOffset() {
      throw new Error("setMicphoneOffset() not implemented");
    }
    // 保存设置的增益数据
    saveMicphoneOffset() {
      throw new Error("saveMicphoneOffset() not implemented");
    }
    /** 滤波器相关 */
    // 读取设备中滤波器相关信息
    readFilterInfo() {
      throw new Error("readFilterInfo() not implemented");
    }
    // 读取滤波器ID(下标、序号)
    readFilterIndex() {
      throw new Error("readFilterInfo() not implemented");
    }
    // 读取滤波器工作模式
    readFilterWorkingMode() {
      throw new Error("readFilterInfo() not implemented");
    }
    // 读取滤波器输出增益模式
    readFilterOutMode() {
      throw new Error("readFilterInfo() not implemented");
    }
    // 读取DAC声道平衡
    readDacBalance() {
      throw new Error("readFilterInfo() not implemented");
    }
    //选择和设置滤波器
    selectFilter(filterCode) {
      throw new Error("readFilterInfo() not implemented");
    }
    //设置滤波器工作模式
    setDacWorkMode(mode) {
      throw new Error("readFilterInfo() not implemented");
    }
    // 设置滤波器输出增益模式
    setDacOffsetMode(mode) {
      throw new Error("readFilterInfo() not implemented");
    }
    //DAC声道平衡
    setDacBalance(left, right) {
      throw new Error("readFilterInfo() not implemented");
    }
  }
  class ChipKT02H20 extends ChipKT {
    /** 基础功能 */
    constructor(device) {
      super(device);
      this.reportId = 75;
      this.deviceTypeNo = "KT02H20";
      this.utilName = "KT02h20";
      this.device = device;
      this.hidService = new HidService(device);
      this.versionBytes = new Array(8);
      this.switch = {
        "READ_TAG_ID_SWITCH": false,
        "READ_VERSION_SWITCH": false,
        "READ_ADC_OFFSET_SWITCH": false
      };
    }
    // 获取设备类型编号
    getDeviceTypeNo() {
      return this.deviceTypeNo;
    }
    /**
     * 获取芯片默认的EQ段数
     * KT02H20 使用5段EQ
     * @returns {number} EQ段数
     */
    getDefaultEqSegments() {
      return 5;
    }
    getFilterIndexs() {
      return {
        //用于曲线图的滤波器排序和下标值选择方案，数值对应写入硬件的值
        "PK": 0,
        //Peak
        "LP": 1,
        //Lowpass
        "HP": 2,
        // Highpass
        "LS": 3,
        // Lowshelf
        "HS": 4
        // Highshelf
      };
    }
    getFilterList() {
      return [
        {
          value: 0,
          jc: "PK",
          name: "Peak"
        },
        {
          value: 1,
          jc: "LP",
          name: "Lowpass"
        },
        {
          value: 2,
          jc: "HP",
          name: "Highpass"
        },
        {
          value: 3,
          jc: "LS",
          name: "Lowshelf"
        },
        {
          value: 4,
          jc: "HS",
          name: "Highshelf"
        }
      ];
    }
    //是否支持Dac滤波器调参
    getIsSupportDacFilterMode() {
      return false;
    }
    //是否支持降噪
    getIsSupportNoiseReduction() {
      return false;
    }
    /**
     * 处理设备输入报告数据
     * @param {Uint8Array} data - 设备返回的数据
     */
    handleInputReport(data) {
      if (data[0] == 2 && this.checkSwitch("READ_TAG_ID_SWITCH")) {
        const tagId = data[6];
        this.emit(BaseChip.EventKeys.ReadEqTagId, tagId);
      }
      if (data[0] == 4 && this.checkSwitch("READ_VERSION_SWITCH", false)) {
        this.versionBytes = [];
        this.versionBytes.push(data[6], data[7], data[8], data[9]);
      }
      if (data[0] == 5 && this.checkSwitch("READ_VERSION_SWITCH")) {
        this.versionBytes.push(data[6], data[7], data[8], data[9]);
        this.versionBytes = this.versionBytes.filter((byte) => byte !== 0);
        const version = String.fromCharCode.apply(0, this.versionBytes);
        this.emit(BaseChip.EventKeys.ReadDeviceVersion, version);
      }
      if (data[0] == 58 && this.checkSwitch("READ_ADC_OFFSET_SWITCH")) {
        const offset = data[6];
        this.emit(BaseChip.EventKeys.ReadMicphoneOffset, offset);
      }
    }
    checkSwitch(key, update = true) {
      const res = this.switch[key];
      if (update) {
        this.switch[key] = false;
      }
      return res;
    }
    openSwitch(key) {
      this.switch[key] = true;
    }
    // 恢复出厂设置
    resetDevice() {
      const byteArry = new Uint8Array([0, 0, 0, 0, 67, 0, 0, 0, 0, 0]);
      this.deviceWrite(byteArry);
    }
    // 读取固件版本
    readDeviceVersion() {
      this.openSwitch("READ_VERSION_SWITCH");
      const byteArry1 = new Uint8Array([4, 0, 0, 0, 82, 0, 0, 0, 0, 0]);
      this.deviceRead(byteArry1);
      const byteArry2 = new Uint8Array([5, 0, 0, 0, 82, 0, 0, 0, 0, 0]);
      this.deviceRead(byteArry2);
    }
    // 获取设备相关信息
    getDeviceInfo() {
    }
    // 刷新到缓存（非重写父类函数）
    refereshToMemery() {
      const byteArry = new Uint8Array([36, 0, 0, 0, 87, 0, 1, 0, 0, 0]);
      this.deviceWrite(byteArry);
    }
    // 刷新缓存到Flash
    refereshToFlash() {
      const byteArry = new Uint8Array([0, 0, 0, 0, 83, 0, 0, 0, 0, 0]);
      this.deviceWrite(byteArry);
    }
    // 读取数据
    async deviceRead(data) {
      if (this.device && this.hidService) {
        await this.hidService.sendReport(this.reportId, data);
        return true;
      }
    }
    // 写入数据
    async deviceWrite(data) {
      if (this.device && this.hidService) {
        await this.hidService.sendReport(this.reportId, data);
        return true;
      }
    }
    /** EQ相关 */
    // 读取EQ TagId
    readEqTagId() {
      this.openSwitch("READ_TAG_ID_SWITCH");
      const byteArry = new Uint8Array([2, 0, 0, 0, 82, 0, 0, 0, 0, 0]);
      this.deviceWrite(byteArry);
    }
    // 读取设备EQ的全局音量 offset
    readEqOffset() {
    }
    // 设置DAC增益Offset
    setDacOffset(size) {
      const s = size / 2 + 13;
      const byteArry = new Uint8Array([59, 0, 0, 0, 87, 0, 0, 0, 0, 0]);
      byteArry[6] = this.toSignedByte(s & 255);
      byteArry[7] = this.toSignedByte(s >> 8 & 255);
      byteArry[8] = this.toSignedByte(s >> 16 & 255);
      byteArry[9] = this.toSignedByte(s >> 24 & 255);
      this.deviceWrite(byteArry);
      this.refereshToMemery();
    }
    // 设置ADC总增益Offset
    setAdcOffset(offset) {
      console.log("设置ADC增益Offset--------", offset);
      const byteArry = new Uint8Array([58, 0, 0, 0, 87, 0, 0, 0, 0, 0]);
      const gainValue = offset;
      byteArry[6] = gainValue & 255;
      byteArry[7] = gainValue >> 8 & 255;
      byteArry[8] = gainValue >> 16 & 255;
      byteArry[9] = gainValue >> 24 & 255;
      this.deviceWrite(byteArry);
      this.refereshToMemery();
    }
    // 写入ADC EQ数据到寄存器
    setAdcEqInfo(eq) {
      const freqs = eq.freqs;
      const qs = eq.qs;
      const gains = eq.gains;
      if (!eq || !eq.freqs || !eq.qs || !eq.gains) {
        console.error("ADC EQ参数不完整，无法写入设备");
        return;
      }
      const byteArry = new Uint8Array([0, 0, 0, 0, 87, 0, 0, 0, 0, 0]);
      const addr = 32;
      this.saveEqTagId(eq.tag);
      for (let i = 0; i < eq.freqs.length; i++) {
        const freq = freqs[i] / 2;
        const q = parseInt(qs[i] * 1e3);
        const gain = parseInt(gains[i] * 10);
        const filterType = eq.filterTypes[i];
        byteArry[0] = addr + ((i + 1) * 2 - 2);
        byteArry[6] = this.toSignedByte(gain & 255);
        byteArry[7] = this.toSignedByte(gain >> 8 & 255);
        byteArry[8] = this.toSignedByte(freq & 255);
        byteArry[9] = this.toSignedByte(freq >> 8 & 255);
        this.deviceWrite(byteArry);
        byteArry[0] = addr + ((i + 1) * 2 - 1);
        byteArry[6] = this.toSignedByte(q & 255);
        byteArry[7] = this.toSignedByte(q >> 8 & 255);
        byteArry[8] = this.toSignedByte(8 + (7 & filterType));
        byteArry[9] = 0;
        this.deviceWrite(byteArry);
      }
      this.refereshToMemery();
    }
    // 保存ADC EQ数据到寄存器，并刷入Flash
    saveAdcEqInfo(eq) {
      this.setAdcEqInfo(eq);
      this.refereshToFlash();
    }
    // 写入EQ数据到寄存器
    setEqInfo(eq) {
      const freqs = eq.freqs;
      const qs = eq.qs;
      const gains = eq.gains;
      if (!eq || !eq.freqs || !eq.qs || !eq.gains) {
        console.error("EQ参数不完整，无法写入设备");
        return;
      }
      const byteArry = new Uint8Array([0, 0, 0, 0, 87, 0, 0, 0, 0, 0]);
      const addr = 38;
      this.saveEqTagId(eq.tag);
      for (let i = 0; i < eq.freqs.length; i++) {
        const freq = freqs[i] / 2;
        const q = parseInt(qs[i] * 1e3);
        const gain = parseInt(gains[i] * 10);
        const filterType = eq.filterTypes[i];
        byteArry[0] = addr + ((i + 1) * 2 - 2);
        byteArry[6] = this.toSignedByte(gain & 255);
        byteArry[7] = this.toSignedByte(gain >> 8 & 255);
        byteArry[8] = this.toSignedByte(freq & 255);
        byteArry[9] = this.toSignedByte(freq >> 8 & 255);
        this.deviceWrite(byteArry);
        byteArry[0] = addr + ((i + 1) * 2 - 1);
        byteArry[6] = this.toSignedByte(q & 255);
        byteArry[7] = this.toSignedByte(q >> 8 & 255);
        byteArry[8] = this.toSignedByte(8 + (7 & filterType));
        byteArry[9] = 0;
        this.deviceWrite(byteArry);
      }
      this.refereshToMemery();
    }
    // 保存EQ TagId
    saveEqTagId(tagId) {
      if (tagId == null || tagId == void 0) {
        console.error("设备或TagId不能为空");
        return;
      }
      const byteArry = new Uint8Array([2, 0, 0, 0, 87, 0, 0, 0, 0, 0]);
      byteArry[6] = tagId & 255;
      byteArry[7] = tagId >> 8 & 255;
      byteArry[8] = tagId >> 16 & 255;
      byteArry[9] = tagId >> 24 & 255;
      this.deviceWrite(byteArry);
    }
    // 写入EQ数据到寄存器，并刷入Flash
    saveEqInfo(eq) {
      this.setEqInfo(eq);
      this.refereshToFlash();
    }
    // EQ数据转换（将界面的EQ参数转换成各芯片可写入的数据）
    getEqBytesFromEQParam() {
      throw new Error("getEqBytesFromEQParam() not implemented");
    }
    /** 麦克风相关 */
    // 读取麦克风增益（offset）
    readMicphoneOffset() {
      this.openSwitch("READ_ADC_OFFSET_SWITCH");
      const byteArry = new Uint8Array([58, 0, 0, 0, 82, 0, 0, 0, 0, 0]);
      this.deviceWrite(byteArry);
    }
    // 设置麦克风增益（offset）
    setMicphoneOffset(offset) {
      if (offset < 0 || offset > 5) {
        return;
      }
      const byteArry = new Uint8Array([58, 0, 0, 0, 87, 0, 0, 0, 0, 0]);
      byteArry[6] = this.toSignedByte(offset & 255);
      byteArry[7] = this.toSignedByte(offset >> 8 & 255);
      byteArry[8] = this.toSignedByte(offset >> 16 & 255);
      byteArry[9] = this.toSignedByte(offset >> 24 & 255);
      this.deviceWrite(byteArry);
    }
    // 保存设置的增益数据
    saveMicphoneOffset() {
      this.refereshToFlash();
    }
    /** 滤波器相关 */
    // 读取设备中滤波器相关信息
    readFilterInfo() {
    }
    // 读取滤波器ID(下标、序号)
    readFilterIndex() {
    }
    // 读取滤波器工作模式
    readFilterWorkingMode() {
    }
    // 读取滤波器输出增益模式
    readFilterOutMode() {
    }
    // 读取DAC声道平衡
    readDacBalance() {
    }
    //选择和设置滤波器
    selectFilter(filterCode) {
    }
    //设置滤波器工作模式
    setDacWorkMode(mode) {
    }
    // 设置滤波器输出增益模式
    setDacOffsetMode(mode) {
    }
    //DAC声道平衡
    setDacBalance(left, right) {
    }
    toSignedByte(value) {
      return value > 127 ? value - 256 : value;
    }
  }
  class ChipKT0231H extends ChipKT {
    /** 基础功能 */
    constructor(device) {
      super(device);
      this.reportId = 75;
      this.deviceTypeNo = "KT0231H";
      this.utilName = "KT0231H";
      this.device = device;
      this.hidService = new HidService(device);
      this.versionBytes = new Array(8);
      this.switch = {
        "READ_TAG_ID_SWITCH": false,
        "READ_VERSION_SWITCH": false,
        "READ_ADC_OFFSET_SWITCH": false
      };
    }
    // 获取设备类型编号
    getDeviceTypeNo() {
      return this.deviceTypeNo;
    }
    /**
     * 获取芯片默认的EQ段数
     * KT0231H 使用6段EQ
     * @returns {number} EQ段数
     */
    getDefaultEqSegments() {
      return 6;
    }
    getFilterIndexs() {
      return {
        //用于曲线图的滤波器排序和下标值选择方案，数值对应写入硬件的值
        "PK": 0,
        //Peak
        "LP": 1,
        //Lowpass
        "HP": 2,
        // Highpass
        "LS": 3,
        // Lowshelf
        "HS": 4
        // Highshelf
      };
    }
    getFilterList() {
      return [
        {
          value: 0,
          jc: "PK",
          name: "Peak"
        },
        {
          value: 1,
          jc: "LP",
          name: "Lowpass"
        },
        {
          value: 2,
          jc: "HP",
          name: "Highpass"
        },
        {
          value: 3,
          jc: "LS",
          name: "Lowshelf"
        },
        {
          value: 4,
          jc: "HS",
          name: "Highshelf"
        }
      ];
    }
    //是否支持Dac滤波器调参
    getIsSupportDacFilterMode() {
      return false;
    }
    //是否支持降噪
    getIsSupportNoiseReduction() {
      return false;
    }
    /**
     * 处理设备输入报告数据
     * @param {Uint8Array} data - 设备返回的数据
     */
    handleInputReport(data) {
      if (data[0] == 22 && this.checkSwitch("READ_TAG_ID_SWITCH")) {
        const tagId = data[6];
        this.emit(BaseChip.EventKeys.ReadEqTagId, tagId);
      }
      if (data[0] == 6 && this.checkSwitch("READ_VERSION_SWITCH", false)) {
        this.versionBytes = [];
        this.versionBytes.push(data[6], data[7], data[8], data[9]);
      }
      if (data[0] == 7 && this.checkSwitch("READ_VERSION_SWITCH")) {
        this.versionBytes.push(data[6], data[7], data[8], data[9]);
        this.versionBytes = this.versionBytes.filter((byte) => byte !== 0);
        const version = String.fromCharCode.apply(0, this.versionBytes);
        this.emit(BaseChip.EventKeys.ReadDeviceVersion, version);
      }
      if (data[0] == 86 && this.checkSwitch("READ_ADC_OFFSET_SWITCH")) {
        const offset = data[6];
        this.emit(BaseChip.EventKeys.ReadMicphoneOffset, offset);
      }
    }
    checkSwitch(key, update = true) {
      const res = this.switch[key];
      if (update) {
        this.switch[key] = false;
      }
      return res;
    }
    openSwitch(key) {
      this.switch[key] = true;
    }
    // 恢复出厂设置
    resetDevice() {
      const byteArry = new Uint8Array([0, 0, 0, 0, 67, 0, 0, 0, 0, 0]);
      this.deviceWrite(byteArry);
    }
    // 读取固件版本
    readDeviceVersion() {
      this.openSwitch("READ_VERSION_SWITCH");
      const byteArry1 = new Uint8Array([6, 0, 0, 0, 82, 0, 0, 0, 0, 0]);
      this.deviceRead(byteArry1);
      const byteArry2 = new Uint8Array([7, 0, 0, 0, 82, 0, 0, 0, 0, 0]);
      this.deviceRead(byteArry2);
    }
    // 获取设备相关信息
    getDeviceInfo() {
    }
    // 刷新到缓存（非重写父类函数）
    refereshToMemery() {
      const byteArry = new Uint8Array([36, 0, 0, 0, 87, 0, 1, 0, 0, 0]);
      this.deviceWrite(byteArry);
    }
    // 刷新缓存到Flash
    refereshToFlash() {
      const byteArry = new Uint8Array([0, 0, 0, 0, 83, 0, 0, 0, 0, 0]);
      this.deviceWrite(byteArry);
    }
    // 读取数据
    async deviceRead(data) {
      if (this.device && this.hidService) {
        await this.hidService.sendReport(this.reportId, data);
        return true;
      }
    }
    // 写入数据
    async deviceWrite(data) {
      if (this.device && this.hidService) {
        await this.hidService.sendReport(this.reportId, data);
        return true;
      }
    }
    /** EQ相关 */
    // 读取EQ TagId
    readEqTagId() {
      this.openSwitch("READ_TAG_ID_SWITCH");
      console.log("我的读取");
      const byteArry = new Uint8Array([22, 0, 0, 0, 82, 0, 0, 0, 0, 0]);
      this.deviceWrite(byteArry);
    }
    // 读取设备EQ的全局音量 offset
    readEqOffset() {
    }
    // 设置DAC增益Offset
    setDacOffset(size) {
      console.log("设置DAC增益Offset--------", size);
      const byteArry = new Uint8Array([87, 0, 0, 0, 87, 0, 0, 0, 0, 0]);
      let s = 0;
      if (size != 0) {
        s = size * -10;
        byteArry[6] = this.toSignedByte(s & 255);
        byteArry[7] = this.toSignedByte(s >> 8 & 255);
        byteArry[8] = this.toSignedByte(s >> 16 & 255);
        byteArry[9] = this.toSignedByte(s >> 24 & 255);
      }
      this.deviceWrite(byteArry);
      this.refereshToMemery();
    }
    // 设置ADC总增益Offset
    setAdcOffset(offset) {
      console.log("设置ADC增益Offset--------", offset);
      const byteArry = new Uint8Array([86, 0, 0, 0, 87, 0, 0, 0, 0, 0]);
      const gainValue = offset;
      byteArry[6] = gainValue & 255;
      byteArry[7] = gainValue >> 8 & 255;
      byteArry[8] = gainValue >> 16 & 255;
      byteArry[9] = gainValue >> 24 & 255;
      this.deviceWrite(byteArry);
      this.refereshToMemery();
    }
    // 写入ADC EQ数据到寄存器
    setAdcEqInfo(eq) {
      const freqs = eq.freqs;
      const qs = eq.qs;
      const gains = eq.gains;
      if (!eq || !eq.freqs || !eq.qs || !eq.gains) {
        console.error("ADC EQ参数不完整，无法写入设备");
        return;
      }
      const byteArry = new Uint8Array([0, 0, 0, 0, 87, 0, 0, 0, 0, 0]);
      const addr = 66;
      this.saveEqTagId(eq.tag);
      for (let i = 0; i < eq.freqs.length; i++) {
        const freq = freqs[i] / 2;
        const q = parseInt(qs[i] * 1e3);
        const gain = parseInt(gains[i] * 10);
        const filterType = eq.filterTypes[i];
        byteArry[0] = addr + ((i + 1) * 2 - 2);
        byteArry[6] = this.toSignedByte(gain & 255);
        byteArry[7] = this.toSignedByte(gain >> 8 & 255);
        byteArry[8] = this.toSignedByte(freq & 255);
        byteArry[9] = this.toSignedByte(freq >> 8 & 255);
        this.deviceWrite(byteArry);
        byteArry[0] = addr + ((i + 1) * 2 - 1);
        byteArry[6] = this.toSignedByte(q & 255);
        byteArry[7] = this.toSignedByte(q >> 8 & 255);
        byteArry[8] = this.toSignedByte(8 + (7 & filterType));
        byteArry[9] = 0;
        this.deviceWrite(byteArry);
      }
      this.refereshToMemery();
    }
    // 保存ADC EQ数据到寄存器，并刷入Flash
    saveAdcEqInfo(eq) {
      this.setAdcEqInfo(eq);
      this.refereshToFlash();
    }
    // 写入EQ数据到寄存器
    setEqInfo(eq) {
      const freqs = eq.freqs;
      const qs = eq.qs;
      const gains = eq.gains;
      if (!eq || !eq.freqs || !eq.qs || !eq.gains) {
        console.error("EQ参数不完整，无法写入设备");
        return;
      }
      const byteArry = new Uint8Array([0, 0, 0, 0, 87, 0, 0, 0, 0, 0]);
      const addr = 53;
      this.saveEqTagId(eq.tag);
      for (let i = 0; i < eq.freqs.length; i++) {
        const freq = freqs[i] / 2;
        const q = parseInt(qs[i] * 1e3);
        const gain = parseInt(gains[i] * 10);
        const filterType = eq.filterTypes[i];
        byteArry[0] = addr + ((i + 1) * 2 - 2);
        byteArry[6] = this.toSignedByte(gain & 255);
        byteArry[7] = this.toSignedByte(gain >> 8 & 255);
        byteArry[8] = this.toSignedByte(freq & 255);
        byteArry[9] = this.toSignedByte(freq >> 8 & 255);
        this.deviceWrite(byteArry);
        byteArry[0] = addr + ((i + 1) * 2 - 1);
        byteArry[6] = this.toSignedByte(q & 255);
        byteArry[7] = this.toSignedByte(q >> 8 & 255);
        byteArry[8] = this.toSignedByte(8 + (7 & filterType));
        byteArry[9] = 0;
        this.deviceWrite(byteArry);
      }
      this.refereshToMemery();
    }
    // 保存EQ TagId
    saveEqTagId(tagId) {
      if (tagId == null || tagId == void 0) {
        console.error("设备或TagId不能为空");
        return;
      }
      const byteArry = new Uint8Array([22, 0, 0, 0, 87, 0, 0, 0, 0, 0]);
      byteArry[6] = tagId & 255;
      byteArry[7] = tagId >> 8 & 255;
      byteArry[8] = tagId >> 16 & 255;
      byteArry[9] = tagId >> 24 & 255;
      this.deviceWrite(byteArry);
    }
    // 写入EQ数据到寄存器，并刷入Flash
    saveEqInfo(eq) {
      this.setEqInfo(eq);
      this.refereshToFlash();
    }
    // EQ数据转换（将界面的EQ参数转换成各芯片可写入的数据）
    getEqBytesFromEQParam() {
      throw new Error("getEqBytesFromEQParam() not implemented");
    }
    /** 麦克风相关 */
    // 读取麦克风增益（offset）
    readMicphoneOffset() {
      this.openSwitch("READ_ADC_OFFSET_SWITCH");
      const byteArry = new Uint8Array([58, 0, 0, 0, 82, 0, 0, 0, 0, 0]);
      this.deviceWrite(byteArry);
    }
    // 设置麦克风增益（offset）
    setMicphoneOffset(offset) {
      if (offset < 0 || offset > 5) {
        return;
      }
      const byteArry = new Uint8Array([86, 0, 0, 0, 87, 0, 0, 0, 0, 0]);
      byteArry[6] = this.toSignedByte(offset & 255);
      byteArry[7] = this.toSignedByte(offset >> 8 & 255);
      byteArry[8] = this.toSignedByte(offset >> 16 & 255);
      byteArry[9] = this.toSignedByte(offset >> 24 & 255);
      this.deviceWrite(byteArry);
      const switchArray = new Uint8Array([24, 0, 0, 0, 87, 0, 0, 0, 0, 0]);
      this.deviceWrite(switchArray);
    }
    // 保存设置的增益数据
    saveMicphoneOffset() {
      this.refereshToFlash();
    }
    /** 滤波器相关 */
    // 读取设备中滤波器相关信息
    readFilterInfo() {
    }
    // 读取滤波器ID(下标、序号)
    readFilterIndex() {
    }
    // 读取滤波器工作模式
    readFilterWorkingMode() {
    }
    // 读取滤波器输出增益模式
    readFilterOutMode() {
    }
    // 读取DAC声道平衡
    readDacBalance() {
    }
    //选择和设置滤波器
    selectFilter(filterCode) {
    }
    //设置滤波器工作模式
    setDacWorkMode(mode) {
    }
    // 设置滤波器输出增益模式
    setDacOffsetMode(mode) {
    }
    //DAC声道平衡
    setDacBalance(left, right) {
    }
    toSignedByte(value) {
      return value > 127 ? value - 256 : value;
    }
  }
  class ChipFactory {
    static create(type, device) {
      const ChipClass = this.CHIP_MAP[type];
      if (!ChipClass) throw new Error(`Unsupported chip type: ${type}`);
      return new ChipClass(device);
    }
  }
  __publicField(ChipFactory, "CHIP_MAP", {
    "CB": ChipCB,
    "CB1300D": ChipCB1300D,
    "KT02H20": ChipKT02H20,
    "KT0231H": ChipKT0231H
  });
  const ChipTypes = ChipFactory.CHIP_MAP;
  const EventKeys = BaseChip$1.EventKeys;
  class DeviceServiceSDK {
    //初始化一个SDK对象
    static initSDK(device, type, options) {
      return new DeviceServiceSDK().init(device, type, options);
    }
    constructor() {
      this.device = null;
      this.chipType = null;
      this.DeviceClient = new BaseChip$1();
    }
    init(device, type, options = null) {
      this.device = device;
      this.chipType = type;
      if (options && options.loggerEnabled !== void 0) {
        logger.setEnabled(options.loggerEnabled);
        logger.log("DeviceServiceSDK init", type, device, options);
      }
      this.DeviceClient = ChipFactory.create(type, device);
      this.DeviceClient.init();
    }
    setLoggerEnabled(enabled) {
      logger.setEnabled(enabled);
    }
    addEventLister(eventName, callback) {
      this.DeviceClient.addEventLister(eventName, callback);
    }
    /**
     * 移除事件监听器
     * @param {string} eventName - 事件名称
     * @param {Function} callback - 要移除的回调函数，如果不提供则移除该事件的所有监听器
     */
    removeEventListener(eventName, callback) {
      this.DeviceClient.removeEventListener(eventName, callback);
    }
    /**
         * 清除所有事件监听器
         */
    clearAllListeners() {
      this.DeviceClient.clearAllListeners();
    }
    /** 基础功能 */
    getGroupName() {
      return this.DeviceClient.getGroupName();
    }
    //获取设备类型编号
    getDeviceTypeNo() {
      return this.DeviceClient.getDeviceTypeNo();
    }
    getFilterIndexs() {
      return this.DeviceClient.getFilterIndexs();
    }
    getFilterList() {
      return this.DeviceClient.getFilterList();
    }
    getIsSupportDacFilterMode() {
      return this.DeviceClient.getIsSupportDacFilterMode();
    }
    //是否支持降噪
    getIsSupportNoiseReduction() {
      return this.DeviceClient.getIsSupportNoiseReduction();
    }
    // 恢复出厂设置
    resetDevice() {
      this.DeviceClient.resetDevice();
    }
    // 读取固件版本
    readDeviceVersion() {
      return this.DeviceClient.readDeviceVersion();
    }
    // 获取设备相关信息
    getDeviceInfo() {
      return this.DeviceClient.getDeviceInfo();
    }
    // 刷新缓存到Flash
    refereshToFlash() {
      this.DeviceClient.refereshToFlash();
    }
    // 读取数据
    deviceRead() {
      return this.DeviceClient.deviceRead();
    }
    // 写入数据
    deviceWrite() {
      return this.DeviceClient.deviceWrite();
    }
    /** EQ相关 */
    // 读取EQ TagId
    readEqTagId() {
      return this.DeviceClient.readEqTagId();
    }
    // 读取ADC EQ TagId
    readAdcEqTagId() {
      return this.DeviceClient.readAdcEqTagId();
    }
    // 读取设备EQ的全局音量 offset
    readEqOffset() {
      return this.DeviceClient.readEqOffset();
    }
    // 设置DAC增益Offset
    setDacOffset(size) {
      return this.DeviceClient.setDacOffset(size);
    }
    // 写入EQ数据到寄存器
    setEqInfo(eq) {
      return this.DeviceClient.setEqInfo(eq);
    }
    // 写入EQ数据到寄存器，并刷入Flash
    saveEqInfo(eq) {
      return this.DeviceClient.saveEqInfo(eq);
    }
    // EQ数据转换（将界面的EQ参数转换成各芯片可写入的数据）
    getEqBytesFromEQParam() {
      return this.DeviceClient.getEqBytesFromEQParam();
    }
    /** 麦克风相关 */
    // 读取麦克风增益（offset）
    readMicphoneOffset() {
      return this.DeviceClient.readMicphoneOffset();
    }
    // ENC开关状态读取
    readENC_Switch() {
      return this.DeviceClient.readENC_Switch();
    }
    // 设置麦克风增益（offset）
    setMicphoneOffset(size) {
      return this.DeviceClient.setMicphoneOffset(size);
    }
    // 保存设置的增益数据
    saveMicphoneOffset() {
      return this.DeviceClient.saveMicphoneOffset();
    }
    setDenoiseSwitch(flag) {
      return this.DeviceClient.setDenoiseSwitch(flag);
    }
    /** 滤波器相关 */
    // 读取设备中滤波器相关信息
    readFilterInfo() {
      return this.DeviceClient.readFilterInfo();
    }
    // 读取滤波器ID(下标、序号)
    readFilterIndex() {
      return this.DeviceClient.readFilterIndex();
    }
    // 读取滤波器工作模式
    readFilterWorkingMode() {
      return this.DeviceClient.readFilterWorkingMode();
    }
    // 读取滤波器输出增益模式
    readFilterOutMode() {
      return this.DeviceClient.readFilterOutMode();
    }
    // 读取DAC声道平衡
    readDacBalance() {
      return this.DeviceClient.readDacBalance();
    }
    //选择和设置滤波器
    selectFilter(filterCode) {
      return this.DeviceClient.selectFilter(filterCode);
    }
    //设置滤波器工作模式
    setDacWorkMode(mode) {
      return this.DeviceClient.setDacWorkMode(mode);
    }
    // 设置滤波器输出增益模式
    setDacOffsetMode(mode) {
      return this.DeviceClient.setDacOffsetMode(mode);
    }
    //DAC声道平衡
    setDacBalance(left, right) {
      return this.DeviceClient.setDacBalance(left, right);
    }
    /** 新增7.1虚拟音效功能 */
    // 读取3D模式开关（0、关闭 1、打开）
    read3DModeSwitch() {
      return this.DeviceClient.read3DModeSwitch();
    }
    // 读取3D模式参数（0、GAME 1、MUSIC 2、MOVIE）
    readSoundSource() {
      return this.DeviceClient.readSoundSource();
    }
    // 读取3D模式增益（-4 - 0）
    read3DGain() {
      return this.DeviceClient.read3DGain();
    }
    // 读取混响（2个参数：0：ON开，1：OFF关，0-9：混响等级）
    readReverb() {
      return this.DeviceClient.readReverb();
    }
    // 读取声源音效（0~359度）
    async readSoundSourceAngle() {
      return this.DeviceClient.readSoundSourceAngle();
    }
    // 3D模式开关设置（0、关闭 1、打开）
    set3DModeSwitch(flag) {
      return this.DeviceClient.set3DModeSwitch(flag);
    }
    // 3D模式参数配置（0、GAME 1、MUSIC 2、MOVIE）
    setModeValue(mode) {
      return this.DeviceClient.setModeValue(mode);
    }
    // 3D模式增益设置（-4 - 0）
    set3DGain(gain) {
      return this.DeviceClient.set3DGain(gain);
    }
    // 配置混响（2个参数：0：ON开，1：OFF关，0-9：混响等级）
    setReverb(flag, level) {
      return this.DeviceClient.setReverb(flag, level);
    }
    // 配置声源音效（0~359度）
    setSoundSourceAngle(soundIndex, angle) {
      return this.DeviceClient.setSoundSourceAngle(soundIndex, angle);
    }
    resetParams() {
      return this.DeviceClient.resetParams();
    }
    // 设置ADC EQ offset
    setAdcOffset(offset) {
      return this.DeviceClient.setAdcOffset(offset);
    }
    // 设置ADC EQ信息
    setAdcEqInfo(eq) {
      return this.DeviceClient.setAdcEqInfo(eq);
    }
    // 写入ADC EQ数据到寄存器，并刷入Flash
    saveAdcEqInfo(eq) {
      return this.DeviceClient.saveAdcEqInfo(eq);
    }
    // 设置ADC耳返开关
    setAdcInEarMonitorsListenSwitch(flag) {
      return this.DeviceClient.setAdcInEarMonitorsListenSwitch(flag);
    }
  }
  exports2.ChipTypes = ChipTypes;
  exports2.EventKeys = EventKeys;
  exports2.default = DeviceServiceSDK;
  Object.defineProperties(exports2, { __esModule: { value: true }, [Symbol.toStringTag]: { value: "Module" } });
});
