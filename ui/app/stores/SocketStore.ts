import { io, type Socket as IOSocket, type SocketOptions, type ManagerOptions } from "socket.io-client"
import type { ConfigState } from "~/types/config";
import type { StoreItem } from "~/types/store";

export const useSocketStore = defineStore('socket', () => {
  const runtimeConfig = useRuntimeConfig()
  const config = useConfigStore()
  const stateStore = useStateStore()
  const toast = useNotification()

  const socket = ref<IOSocket | null>(null)
  const isConnected = ref<boolean>(false)

  const emit = (event: string, data?: any): any => socket.value?.emit(event, data)
  const on = (event: string | string[], callback: (...args: any[]) => void, withEvent: boolean = false) => {
    if (!Array.isArray(event)) {
      event = [event]
    }
    event.forEach(e => socket.value?.on(e, (...args) => true === withEvent ? callback(e, ...args) : callback(...args)))
  }

  const off = (event: string | string[], callback?: (...args: any[]) => void): any => {
    if (!Array.isArray(event)) {
      event = [event]
    }
    event.forEach(e => socket.value?.off(e, callback));
  }

  const connect = () => {
    const opts = {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 30,
      reconnectionDelay: 5000
    } as Partial<ManagerOptions & SocketOptions>

    let url = runtimeConfig.public.wss

    if ('development' !== runtimeConfig.public?.APP_ENV) {
      url = window.origin;
      opts.path = `${runtimeConfig.app.baseURL.replace(/\/$/, '')}/socket.io`;
    } else {
      window.ws = socket.value;
    }

    socket.value = io(url, opts)

    socket.value.on('connect', () => isConnected.value = true);
    socket.value.on('disconnect', () => isConnected.value = false);

    socket.value.on('connected', stream => {
      const json = JSON.parse(stream)

      config.setAll({
        app: json.data.config,
        tasks: json.data.tasks,
        folders: json.data.folders,
        presets: json.data.presets,
        dl_fields: json.data.dl_fields,
        paused: Boolean(json.data.paused)
      } as Partial<ConfigState>)

      stateStore.addAll('queue', json.data.queue || {})
      stateStore.addAll('history', json.data.done || {})
    })

    on('item_added', stream => {
      const json = JSON.parse(stream);
      stateStore.add('queue', json.data._id, json.data);
      toast.success(`Item queued: ${ag(stateStore.get('queue', json.data._id, {} as StoreItem), 'title')}`);
    });

    on(['log_info', 'log_success', 'log_warning', 'log_error'], (event: string, stream: string) => {
      const json = JSON.parse(stream);
      const message = json?.message || json?.data?.message;
      const data = json.data?.data || json.data || {};
      switch (event) {
        case 'log_info':
          toast.info(message, data);
          break;
        case 'log_success':
          toast.success(message, data);
          break;
        case 'log_warning':
          toast.warning(message, data);
          break;
        case 'log_error':
          toast.error(message, data);
          break;
      }
    }, true);

    on('item_completed', (stream: string) => {
      const json = JSON.parse(stream);

      if (true === stateStore.has('queue', json.data._id)) {
        stateStore.remove('queue', json.data._id);
      }

      if (true === stateStore.has('history', json.data._id)) {
        stateStore.update('history', json.data._id, json.data);
        return;
      }

      stateStore.add('history', json.data._id, json.data);
    });

    on('item_cancelled', (stream: string) => {
      const item = JSON.parse(stream);
      const id = item.data._id

      if (true !== stateStore.has('queue', id)) {
        return
      }

      toast.warning(`Download cancelled: ${ag(stateStore.get('queue', id, {} as StoreItem), 'title')}`);

      if (true === stateStore.has('queue', id)) {
        stateStore.remove('queue', id);
      }
    });

    on('item_deleted', (stream: string) => {
      const item = JSON.parse(stream);
      const id = item.data._id

      if (true !== stateStore.has('history', id)) {
        return
      }

      stateStore.remove('history', id);
    });

    on('item_updated', (stream: string) => {
      const json = JSON.parse(stream);
      const id = json.data._id;

      if (true === stateStore.has('history', id)) {
        stateStore.update('history', id, json.data);
        return;
      }

      if (true === stateStore.has('queue', id)) {
        stateStore.update('queue', id, json.data);
      }
    });

    on('item_moved', (stream: string) => {
      const json = JSON.parse(stream);
      const to = json.data.to;
      const id = json.data.item._id;

      if ('queue' === to) {
        if (true === stateStore.has('history', id)) {
          stateStore.remove('history', id);
        }
        stateStore.add('queue', id, json.data.item);
      }

      if ('history' === to) {
        if (true === stateStore.has('queue', id)) {
          stateStore.remove('queue', id);
        }
        stateStore.add('history', id, json.data.item);
      }
    });

    on(['paused', 'resumed'], (event: string, data: string) => {
      const json = JSON.parse(data);
      const pausedState = Boolean(json.data.paused);
      config.update('paused', pausedState);

      if ('resumed' === event) {
        toast.success('Download queue resumed.');
        return;
      }

      toast.warning('Download queue paused.', { timeout: 10000 });
    }, true);

    on('presets_update', (data: string) => config.update('presets', JSON.parse(data).data || []));
    on('dlfields_update', (data: string) => config.update('dl_fields', JSON.parse(data).data || []));
  }

  if (false === isConnected.value) {
    connect();
  }


  return { connect, on, off, emit, socket, isConnected };
});
