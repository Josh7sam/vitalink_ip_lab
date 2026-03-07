import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/storage/secure_storage.dart';

class SessionExpiryHandler {
  SessionExpiryHandler._();

  static final SecureStorage _storage = SecureStorage();
  static Future<void>? _pendingReset;

  static Future<void> clearSessionAndRedirectToLogin() {
    return _pendingReset ??= _run().whenComplete(() => _pendingReset = null);
  }

  static Future<void> _run() async {
    await _storage.clearAll();
    await QueryCache.instance.clear();

    final navigator = AppRouter.navigatorKey.currentState;
    if (navigator == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        AppRouter.navigatorKey.currentState?.pushNamedAndRemoveUntil(
          AppRoutes.login,
          (_) => false,
        );
      });
      return;
    }

    navigator.pushNamedAndRemoveUntil(AppRoutes.login, (_) => false);
  }
}