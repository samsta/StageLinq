import { strict as assert } from 'assert';
import { ReadContext } from '../utils/ReadContext';
import { WriteContext } from '../utils/WriteContext';
import { ServiceMessage, StateNames } from '../types';
import { DeviceId } from '../devices'
import { Socket } from 'net';
import { Logger } from '../LogEmitter';
import { Service } from '../services';
import { StageLinq } from '../StageLinq';
import * as stagelinqConfig from '../stagelinqConfig.json';
import EventEmitter = require('events');

export type Player = typeof stagelinqConfig.player;
export type PlayerDeck = typeof stagelinqConfig.playerDeck;
export type Mixer = typeof stagelinqConfig.mixer;

const MAGIC_MARKER = 'smaa';

enum Action {
  request = 0x000007d2,
  response = 0x00000000,
}

enum Result {
  accept = 0x00000000,
  reject = 0xffffffff,
  inquire = 0x00000064
}

const MAGIC_MARKER_INTERVAL = 0x000007d2;
const MAGIC_MARKER_JSON = 0x00000000;

// function stateReducer(obj: any, prefix: string): string[] {
//   const entries = Object.entries(obj)
//   const retArr = entries.map(([key, value]) => {
//     return (typeof value === 'object' ? [...stateReducer(value, `${prefix}${key}/`)] : `${prefix}${key}`)
//   })
//   return retArr.flat()
// }

// const playerStateValues = stateReducer(stagelinqConfig.player, '/');
// const mixerStateValues = stateReducer(stagelinqConfig.mixer, '/');
// const controllerStateValues = [...playerStateValues, ...mixerStateValues];

const playerStateValues = Object.values(StateNames.player);
const mixerStateValues = Object.values(StateNames.mixer);
const controllerStateValues = [...playerStateValues, ...mixerStateValues];


export interface StateData {
  service: StateMap;
  deviceId: DeviceId;
  name?: string;
  json?: {
    type: number;
    string?: string;
    value?: number;
    state?: boolean;
  };
  interval?: number;
}

/**
 * StateMap Class
 */
export class StateMap extends Service<StateData> {
  public readonly name = "StateMap";
  static readonly emitter: EventEmitter = new EventEmitter();
  static #instances: Map<string, StateMap> = new Map()

  /**
   * @constructor
   * @param {StageLinq} parent 
   * @param {StateMapHandler} serviceHandler 
   * @param {DeviceId} deviceId 
   */
  constructor(parent: StageLinq, deviceId?: DeviceId) {
    super(parent, deviceId)
    StateMap.#instances.set(this.deviceId.string, this)
    this.addListener('newDevice', (service: StateMap) => StateMap.instanceListener('newDevice', service))
    this.addListener('newDevice', (service: StateMap) => this.parent.status.addDecks(service))
    this.addListener('stateMessage', (data: StateData) => StateMap.instanceListener('stateMessage', data))
  }

  private static instanceListener(eventName: string, ...args: any) {
    StateMap.emitter.emit(eventName, ...args)
  }

  /**
   * Subscribe to StateMap States
   */
  public async subscribe() {
    const socket = this.socket;

    Logger.silly(`Sending Statemap subscriptions to ${socket.remoteAddress}:${socket.remotePort} ${this.deviceId.string}`);


    switch (this.device.info.unit?.type) {
      case "PLAYER": {
        for (let state of playerStateValues) {
          await this.subscribeState(state, 0, socket);
        }
        break;
      }
      case "CONTROLLER": {
        for (let state of controllerStateValues) {
          await this.subscribeState(state, 0, socket);
        }
        break;
      }
      case "MIXER": {
        for (let state of mixerStateValues) {
          await this.subscribeState(state, 0, socket);
        }
        break;
      }
      default:
        break;
    }
  }


  protected parseData(ctx: ReadContext): ServiceMessage<StateData> {
    assert(this.deviceId);

    const marker = ctx.getString(4);
    if (marker !== MAGIC_MARKER) {
      Logger.error(assert(marker !== MAGIC_MARKER));
    }
    assert(marker === MAGIC_MARKER);

    const type = ctx.readUInt32();
    switch (type) {
      case MAGIC_MARKER_JSON: {
        const name = ctx.readNetworkStringUTF16();
        let jsonString = "";
        try {
          jsonString = ctx.readNetworkStringUTF16();
          const json = JSON.parse(jsonString);
          return {
            id: MAGIC_MARKER_JSON,
            message: {
              name: name,
              json: json,
              service: this,
              deviceId: this.deviceId,
            },
          };
        } catch (err) {
          Logger.error(this.name, jsonString, err);
        }
      }

      case MAGIC_MARKER_INTERVAL: {
        const name = ctx.readNetworkStringUTF16();
        const interval = ctx.readInt32();
        ctx.seek(-4);

        return {
          id: MAGIC_MARKER_INTERVAL,
          message: {
            service: this,
            deviceId: this.deviceId,
            name: name,
            interval: interval,
          },
        };
      }
      default:
        break;
    }
    assert.fail(`Unhandled type ${type}`);
  }

  protected messageHandler(data: ServiceMessage<StateData>): void {

    if (this.listenerCount(data?.message?.name) && data?.message?.json) {
      this.emit(data.message.name, data.message)
    }

    if (data?.message?.interval) {
      this.sendStateResponse(data.message.name, data.message.service.socket);
    }
    if (data?.message?.json) {
      this.emit('stateMessage', data.message);
    }
  }

  /**
   * Respond to StateMap request with rejection
   * @param {string} state 
   * @param {Socket} socket 
   */
  private async sendStateResponse(state: string, socket: Socket) {

    const getMessage = function (): Buffer {
      const ctx = new WriteContext();
      ctx.writeFixedSizedString(MAGIC_MARKER);
      ctx.writeUInt32(Action.response);
      ctx.writeNetworkStringUTF16(state);
      ctx.writeUInt32(Result.reject);
      return ctx.getBuffer();
    };

    const message = getMessage();

    const ctx = new WriteContext();
    ctx.writeUInt32(message.length);
    ctx.write(message)
    const buffer = ctx.getBuffer();
    await socket.write(buffer);
  }

  /**
   * Send subcribe to state message to device
   * @param {string} state Path/Name of the State
   * @param {number} interval TODO clear this up
   * @param {Socket} socket 
   */
  private async subscribeState(state: string, interval: number, socket: Socket) {

    const getMessage = function (): Buffer {
      const ctx = new WriteContext();
      ctx.writeFixedSizedString(MAGIC_MARKER);
      ctx.writeUInt32(MAGIC_MARKER_INTERVAL);
      ctx.writeNetworkStringUTF16(state);
      ctx.writeUInt32(interval);
      return ctx.getBuffer();
    };

    const message = getMessage();

    const ctx = new WriteContext();
    ctx.writeUInt32(message.length);
    ctx.write(message)
    const buffer = ctx.getBuffer();
    await socket.write(buffer);
  }
}