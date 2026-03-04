typedef StreamEventCallback = void Function(String eventName, String data);

abstract class NotificationStreamClient {
  Future<void> connect({
    required Uri uri,
    required String token,
    required StreamEventCallback onEvent,
    required void Function(Object error) onError,
    required void Function() onDone,
  });

  Future<void> disconnect();
}

