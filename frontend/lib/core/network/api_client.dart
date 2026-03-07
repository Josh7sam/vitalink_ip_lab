import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:frontend/core/constants/strings.dart';
import 'package:frontend/core/auth/session_expiry_handler.dart';
import 'package:frontend/core/storage/secure_storage.dart';

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;

  @override
  String toString() => 'ApiException($statusCode): $message';
}

/// Lightweight API client that attaches bearer tokens when available and
/// normalizes the backend's ApiResponse shape.
class ApiClient {
  ApiClient({
    Dio? dio,
    SecureStorage? secureStorage,
    String? baseUrl,
  }) : _dio = dio ??
            Dio(
              BaseOptions(
                baseUrl: baseUrl ?? AppStrings.apiBaseUrl,
                connectTimeout: const Duration(seconds: 15),
                sendTimeout: const Duration(seconds: 20),
                receiveTimeout: const Duration(seconds: 20),
              ),
            ),
       _secureStorage = secureStorage ?? SecureStorage() {
    _configureInterceptors();
  }

  final Dio _dio;
  final SecureStorage _secureStorage;
  static const int _maxGetRetries = 2;
  static const Duration _retryBaseDelay = Duration(milliseconds: 300);

  void _logDebug(String message) {
    if (kDebugMode) debugPrint(message);
  }

  void _configureInterceptors() {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onError: (error, handler) async {
          if (_shouldHandleUnauthorized(error)) {
            await SessionExpiryHandler.clearSessionAndRedirectToLogin();
          }
          handler.next(error);
        },
      ),
    );
  }

  bool _shouldHandleUnauthorized(DioException error) {
    if (error.response?.statusCode != 401) return false;

    final requiresAuth = error.requestOptions.extra['requiresAuth'] == true;
    final authHeader = error.requestOptions.headers['Authorization'];
    final hasAuthHeader = authHeader is String && authHeader.trim().isNotEmpty;
    return requiresAuth || hasAuthHeader;
  }

  Options _buildRequestOptions({
    required Map<String, String> headers,
    required bool requiresAuth,
  }) {
    return Options(
      headers: headers,
      extra: {'requiresAuth': requiresAuth},
    );
  }

  Future<Response<Map<String, dynamic>>> _sendWithRetry(
    Future<Response<Map<String, dynamic>>> Function() send, {
    bool retryOnFailure = false,
  }) async {
    var attempt = 0;
    while (true) {
      try {
        return await send();
      } on DioException catch (e) {
        final shouldRetry =
            retryOnFailure &&
            attempt < _maxGetRetries &&
            _isTransientFailure(e);
        if (!shouldRetry) rethrow;

        attempt++;
        final wait = Duration(
          milliseconds: _retryBaseDelay.inMilliseconds * (1 << (attempt - 1)),
        );
        _logDebug(
          'Transient API failure. Retrying in ${wait.inMilliseconds}ms (attempt $attempt/$_maxGetRetries)',
        );
        await Future.delayed(wait);
      }
    }
  }

  bool _isTransientFailure(DioException e) {
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.connectionError:
        return true;
      case DioExceptionType.badResponse:
        final code = e.response?.statusCode ?? 0;
        return code == 429 || code >= 500;
      case DioExceptionType.badCertificate:
      case DioExceptionType.cancel:
      case DioExceptionType.unknown:
        return false;
    }
  }

  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic>? data,
    bool authenticated = true,
  }) async {
    try {
      final headers = await _buildHeaders(includeAuth: authenticated);
      final response = await _sendWithRetry(
        () => _dio.post<Map<String, dynamic>>(
          path,
          data: data,
          options: _buildRequestOptions(
            headers: headers,
            requiresAuth: authenticated,
          ),
        ),
      );
      return _normalizeResponse(response);
    } on DioException catch (e) {
      throw ApiException(
        _extractMessage(e),
        statusCode: e.response?.statusCode,
      );
    }
  }

  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    bool authenticated = true,
  }) async {
    final hasQueryParams = queryParameters != null && queryParameters.isNotEmpty;
    try {
      final headers = await _buildHeaders(includeAuth: authenticated);
      _logDebug('GET Request to: $path');
      final response = await _sendWithRetry(
        () => _dio.get<Map<String, dynamic>>(
          path,
          queryParameters: queryParameters,
          options: _buildRequestOptions(
            headers: headers,
            requiresAuth: authenticated,
          ),
        ),
        retryOnFailure: true,
      );
      _logDebug('GET Response status: ${response.statusCode}');
      return _normalizeResponse(response);
    } on DioException catch (e) {
      final message = _extractMessage(e);
      if (hasQueryParams && _isIncomingMessageQuerySetterError(message)) {
        _logDebug(
          'Backend query-parser incompatibility detected. Retrying GET without query parameters: $path',
        );
        final headers = await _buildHeaders(includeAuth: authenticated);
        final retryResponse = await _sendWithRetry(
          () => _dio.get<Map<String, dynamic>>(
            path,
            options: _buildRequestOptions(
              headers: headers,
              requiresAuth: authenticated,
            ),
          ),
          retryOnFailure: true,
        );
        return _normalizeResponse(retryResponse);
      }
      throw ApiException(
        message,
        statusCode: e.response?.statusCode,
      );
    }
  }

  Future<Map<String, dynamic>> put(
    String path, {
    Map<String, dynamic>? data,
    bool authenticated = true,
  }) async {
    try {
      final headers = await _buildHeaders(includeAuth: authenticated);
      _logDebug('PUT Request to: $path');
      final response = await _sendWithRetry(
        () => _dio.put<Map<String, dynamic>>(
          path,
          data: data,
          options: _buildRequestOptions(
            headers: headers,
            requiresAuth: authenticated,
          ),
        ),
      );
      _logDebug('PUT Response status: ${response.statusCode}');
      return _normalizeResponse(response);
    } on DioException catch (e) {
      throw ApiException(
        _extractMessage(e),
        statusCode: e.response?.statusCode,
      );
    }
  }

  Future<Map<String, dynamic>> patch(
    String path, {
    Map<String, dynamic>? data,
    bool authenticated = true,
  }) async {
    try {
      final headers = await _buildHeaders(includeAuth: authenticated);
      final response = await _sendWithRetry(
        () => _dio.patch<Map<String, dynamic>>(
          path,
          data: data,
          options: _buildRequestOptions(
            headers: headers,
            requiresAuth: authenticated,
          ),
        ),
      );
      return _normalizeResponse(response);
    } on DioException catch (e) {
      throw ApiException(
        _extractMessage(e),
        statusCode: e.response?.statusCode,
      );
    }
  }

  Future<Map<String, dynamic>> delete(
    String path, {
    Map<String, dynamic>? data,
    bool authenticated = true,
  }) async {
    try {
      final headers = await _buildHeaders(includeAuth: authenticated);
      _logDebug('DELETE Request to: $path');
      final response = await _sendWithRetry(
        () => _dio.delete<Map<String, dynamic>>(
          path,
          data: data,
          options: _buildRequestOptions(
            headers: headers,
            requiresAuth: authenticated,
          ),
        ),
      );
      _logDebug('DELETE Response status: ${response.statusCode}');
      return _normalizeResponse(response);
    } on DioException catch (e) {
      throw ApiException(
        _extractMessage(e),
        statusCode: e.response?.statusCode,
      );
    }
  }

  /// Returns the full response body without stripping the `data` wrapper.
  /// Useful for paginated responses that include `pagination` alongside `data`.
  Future<Map<String, dynamic>> getRaw(
    String path, {
    Map<String, dynamic>? queryParameters,
    bool authenticated = true,
  }) async {
    final hasQueryParams = queryParameters != null && queryParameters.isNotEmpty;
    try {
      final headers = await _buildHeaders(includeAuth: authenticated);
      final response = await _sendWithRetry(
        () => _dio.get<Map<String, dynamic>>(
          path,
          queryParameters: queryParameters,
          options: _buildRequestOptions(
            headers: headers,
            requiresAuth: authenticated,
          ),
        ),
        retryOnFailure: true,
      );
      final statusCode = response.statusCode ?? 500;
      final body = response.data ?? <String, dynamic>{};
      if (statusCode >= 400 || body['success'] == false) {
        throw ApiException(
          _sanitizeServerMessage(body['message']?.toString()),
          statusCode: statusCode,
        );
      }
      return body;
    } on DioException catch (e) {
      final message = _extractMessage(e);
      if (hasQueryParams && _isIncomingMessageQuerySetterError(message)) {
        _logDebug(
          'Backend query-parser incompatibility detected. Retrying raw GET without query parameters: $path',
        );
        final headers = await _buildHeaders(includeAuth: authenticated);
        final retryResponse = await _sendWithRetry(
          () => _dio.get<Map<String, dynamic>>(
            path,
            options: _buildRequestOptions(
              headers: headers,
              requiresAuth: authenticated,
            ),
          ),
          retryOnFailure: true,
        );
        final statusCode = retryResponse.statusCode ?? 500;
        final body = retryResponse.data ?? <String, dynamic>{};
        if (statusCode >= 400 || body['success'] == false) {
          throw ApiException(
            _sanitizeServerMessage(body['message']?.toString()),
            statusCode: statusCode,
          );
        }
        return body;
      }
      throw ApiException(
        message,
        statusCode: e.response?.statusCode,
      );
    }
  }

  Future<Map<String, String>> _buildHeaders({required bool includeAuth}) async {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (includeAuth) {
      final token = await _secureStorage.readToken();
      if (token != null && token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
        _logDebug('Authorization header attached');
      }
    }
    return headers;
  }

  Map<String, dynamic> _normalizeResponse(
    Response<Map<String, dynamic>> response,
  ) {
    final statusCode = response.statusCode ?? 500;
    final body = response.data ?? <String, dynamic>{};

    if (statusCode >= 400 || body['success'] == false) {
      throw ApiException(
        _sanitizeServerMessage(body['message']?.toString()),
        statusCode: statusCode,
      );
    }

    // Handle the backend's ApiResponse format with 'data' wrapper
    if (body.containsKey('data')) {
      final data = body['data'];
      if (data is Map<String, dynamic>) {
        return data;
      }
      if (data is List) {
        return {'items': data};
      }
      // If data is null or empty, return it as is
      return data ?? <String, dynamic>{};
    }

    if (body.isNotEmpty) return body;
    return <String, dynamic>{};
  }

  String _extractMessage(DioException e) {
    final res = e.response;
    _logDebug('API Error - Status Code: ${res?.statusCode}');
    _logDebug('API Error - Response: ${res?.data}');
    _logDebug('API Error - Dio Type: ${e.type}');
    _logDebug('API Error - Dio Message: ${e.message}');

    if (res?.statusCode == 401) {
      _logDebug('Authentication failed - token may be invalid or expired');
    }

    if (res?.data is Map<String, dynamic>) {
      final map = res?.data as Map<String, dynamic>;
      if (map['message'] is String) {
        return _sanitizeServerMessage(map['message'] as String);
      }
      if (map['error'] is String) {
        return _sanitizeServerMessage(map['error'] as String);
      }
    }

    if (_isConnectionFailure(e)) {
      return _sanitizeServerMessage(
        'Unable to reach the server. Check your internet connection and try again.',
      );
    }

    return _sanitizeServerMessage(e.message);
  }

  bool _isIncomingMessageQuerySetterError(String message) {
    final lower = message.toLowerCase();
    return lower.contains('cannot set property query') &&
        (lower.contains('incomingmessage') || lower.contains('incommingmessage'));
  }

  String _sanitizeServerMessage(String? raw) {
    final message = (raw == null || raw.trim().isEmpty) ? 'Request failed' : raw;

    // Flutter Web often wraps CORS/TLS/DNS failures in this XHR onError text.
    if (_isBrowserXhrNetworkError(message)) {
      return 'Unable to reach the server. Please try again in a moment.';
    }

    if (_isIncomingMessageQuerySetterError(message)) {
      return 'Server configuration error. Please contact support.';
    }
    return message;
  }

  bool _isConnectionFailure(DioException e) {
    final noResponse = e.response == null;
    final isConnectionType =
        e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.sendTimeout;
    if (isConnectionType && noResponse) return true;

    // Dio on web may surface these failures as unknown with an XHR onError message.
    final message = (e.message ?? '').toLowerCase();
    if (kIsWeb &&
        e.type == DioExceptionType.unknown &&
        (message.contains('xmlhttprequest onerror callback was called') ||
            message.contains('network layer'))) {
      return true;
    }
    return false;
  }

  bool _isBrowserXhrNetworkError(String message) {
    final lower = message.toLowerCase();
    return lower.contains('xmlhttprequest onerror callback was called') ||
        lower.contains('error on the network layer');
  }
}
