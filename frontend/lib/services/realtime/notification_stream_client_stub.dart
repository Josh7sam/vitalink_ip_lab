import 'notification_stream_client_interface.dart';

class _StubNotificationStreamClient implements NotificationStreamClient {
  @override
  Future<void> connect({
    required Uri uri,
    required String token,
    required StreamEventCallback onEvent,
    required void Function(Object error) onError,
    required void Function() onDone,
  }) async {
    onError(UnsupportedError('Notification streaming is not supported'));
  }

  @override
  Future<void> disconnect() async {}
}

NotificationStreamClient createPlatformNotificationStreamClient() =>
    _StubNotificationStreamClient();

