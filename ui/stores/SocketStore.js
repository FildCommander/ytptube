import { io } from "socket.io-client";
import { ag } from "~/utils/index"

export const useSocketStore = defineStore('socket', () => {
  const runtimeConfig = useRuntimeConfig()
  const config = useConfigStore()
  const stateStore = useStateStore()
  const toast = useNotification()

  const socket = ref(null)
  const isConnected = ref(false)

  const connect = () => {
    let opts = {
      transports: ['websocket', 'polling'],
      withCredentials: true,
    }

    let url = runtimeConfig.public.wss

    if ('development' !== runtimeConfig.public?.APP_ENV) {
      url = window.origin;
      opts.path = `${runtimeConfig.app.baseURL.replace(/\/$/, '')}/socket.io`;
    }

    socket.value = io(url, opts)

    socket.value.on('connect', () => isConnected.value = true);
    socket.value.on('disconnect', () => isConnected.value = false);

    socket.value.on('initial_data', stream => {
      const initialData = JSON.parse(stream)

      config.setAll({
        app: initialData['config'],
        tasks: initialData['tasks'],
        folders: initialData['folders'],
        presets: initialData['presets'],
        paused: Boolean(initialData['paused'])
      })

      stateStore.addAll('queue', initialData['queue'] ?? {})
      stateStore.addAll('history', initialData['done'] ?? {})
    })

    socket.value.on('added', stream => {
      const item = JSON.parse(stream);
      stateStore.add('queue', item._id, item);
      toast.success(`Item queued: ${ag(stateStore.get('queue', item._id, {}), 'title')}`);
    });

    socket.value.on('error', stream => {
      const json = JSON.parse(stream);
      toast.error(`${json.data?.id ?? json?.type}: ${json?.message}`);
    });

    socket.value.on('log_info', stream => {
      const json = JSON.parse(stream);
      toast.info(json?.message);
    });

    socket.value.on('log_success', stream => {
      const json = JSON.parse(stream);
      toast.success(json?.message);
    });

    socket.value.on('log_warning', stream => {
      const json = JSON.parse(stream);
      toast.warning(json?.message);
    });

    socket.value.on('log_error', stream => {
      const json = JSON.parse(stream);
      toast.error(json?.message);
    });

    socket.value.on('completed', stream => {
      const item = JSON.parse(stream);

      if (true === stateStore.has('queue', item._id)) {
        stateStore.remove('queue', item._id);
      }

      stateStore.add('history', item._id, item);
    });

    socket.value.on('cancelled', stream => {
      const item = JSON.parse(stream);
      const id = item._id

      if (true !== stateStore.has('queue', id)) {
        return
      }

      toast.warning(`Download cancelled: ${ag(stateStore.get('queue', id, {}), 'title')}`);

      if (true === stateStore.has('queue', id)) {
        stateStore.remove('queue', id);
      }
    });

    socket.value.on('cleared', stream => {
      const item = JSON.parse(stream);
      const id = item._id

      if (true !== stateStore.has('history', id)) {
        return
      }

      stateStore.remove('history', id);
    });

    socket.value.on("updated", stream => {
      const data = JSON.parse(stream);

      if (true === stateStore.has('history', data._id)) {
        stateStore.update('history', data._id, data);
        return;
      }

      let dl = stateStore.get('queue', data._id, {});
      data.deleting = dl?.deleting;
      stateStore.update('queue', data._id, data);
    });

    socket.value.on("update", stream => {
      const data = JSON.parse(stream);
      if (true === stateStore.has('history', data._id)) {
        stateStore.update('history', data._id, data);
        return;
      }
    });

    socket.value.on('paused', data => {
      const json = JSON.parse(data);
      const pausedState = Boolean(json.paused);
      config.update('paused', pausedState);

      if (false === pausedState) {
        toast.success('Download queue resumed.');
        return;
      }

      toast.warning('Download queue paused.', {
        timeout: 10000,
      });
    });

    socket.value.on('presets_update', data => config.update('presets', JSON.parse(data)));
  }

  const on = (event, callback) => socket.value.on(event, callback);
  const off = (event, callback) => socket.value.off(event, callback);
  const emit = (event, data) => socket.value.emit(event, data);

  if (false === isConnected.value) {
    connect();
  }

  window.ws = socket.value;

  return { connect, on, off, emit, socket, isConnected };
});
