import 'notification_stream_client_interface.dart';
import 'notification_stream_client_stub.dart'
    if (dart.library.io) 'notification_stream_client_io.dart'
    if (dart.library.html) 'notification_stream_client_web.dart';

NotificationStreamClient createNotificationStreamClient() =>
    createPlatformNotificationStreamClient();

