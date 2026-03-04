import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'notification_stream_client_interface.dart';

class _IoNotificationStreamClient implements NotificationStreamClient {
  HttpClient? _httpClient;
  StreamSubscription<String>? _lineSubscription;

  @override
  Future<void> connect({
    required Uri uri,
    required String token,
    required StreamEventCallback onEvent,
    required void Function(Object error) onError,
    required void Function() onDone,
  }) async {
    await disconnect();

    final client = HttpClient();
    _httpClient = client;

    final request = await client.getUrl(uri);
    request.headers.set(HttpHeaders.acceptHeader, 'text/event-stream');
    if (token.isNotEmpty) {
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
    }

    final response = await request.close();
    if (response.statusCode != HttpStatus.ok) {
      throw HttpException(
        'Failed to connect to notification stream: ${response.statusCode}',
        uri: uri,
      );
    }

    String currentEvent = 'message';
    final dataBuffer = <String>[];

    void dispatchIfReady() {
      if (dataBuffer.isEmpty) return;
      final payload = dataBuffer.join('\n');
      onEvent(currentEvent, payload);
      currentEvent = 'message';
      dataBuffer.clear();
    }

    _lineSubscription = response
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen(
      (line) {
        if (line.isEmpty) {
          dispatchIfReady();
          return;
        }

        if (line.startsWith('event:')) {
          currentEvent = line.substring(6).trim();
          return;
        }

        if (line.startsWith('data:')) {
          dataBuffer.add(line.substring(5).trimLeft());
          return;
        }
      },
      onError: onError,
      onDone: () {
        dispatchIfReady();
        onDone();
      },
      cancelOnError: true,
    );
  }

  @override
  Future<void> disconnect() async {
    await _lineSubscription?.cancel();
    _lineSubscription = null;
    _httpClient?.close(force: true);
    _httpClient = null;
  }
}

NotificationStreamClient createPlatformNotificationStreamClient() =>
    _IoNotificationStreamClient();

