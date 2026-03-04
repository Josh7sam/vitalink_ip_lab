import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/patient_query_keys.dart';
import 'package:frontend/core/widgets/index.dart';
import 'package:frontend/features/patient/patient_health_reports_page.dart';
import 'package:frontend/features/patient/patient_page.dart';
import 'package:frontend/features/patient/patient_profile_page.dart';
import 'package:frontend/features/patient/patient_take_dosage_page.dart';
import 'package:frontend/features/patient/patient_update_inr_page.dart';
import 'package:frontend/services/realtime/doctor_update_realtime_service.dart';

bool shouldShowUnreadUpdatesPopup({
  required int unreadCount,
  required int? previousUnreadCount,
  required bool popupScheduled,
}) {
  if (popupScheduled || unreadCount <= 0) return false;
  if (previousUnreadCount != null && unreadCount <= previousUnreadCount) {
    return false;
  }
  return true;
}

bool shouldShowSystemAnnouncementPopup({
  required String? notificationId,
  required String? notificationType,
  required bool popupScheduled,
  required Set<String> seenNotificationIds,
}) {
  if (popupScheduled) return false;
  if (notificationType != 'SYSTEM_ANNOUNCEMENT') return false;
  if (notificationId == null || notificationId.isEmpty) return false;
  return !seenNotificationIds.contains(notificationId);
}

class PatientDashboardShellPage extends StatefulWidget {
  final int initialTabIndex;

  const PatientDashboardShellPage({
    super.key,
    this.initialTabIndex = 0,
  });

  @override
  State<PatientDashboardShellPage> createState() =>
      _PatientDashboardShellPageState();
}

class _PatientDashboardShellPageState extends State<PatientDashboardShellPage>
    with WidgetsBindingObserver {
  late int _currentNavIndex;
  late final List<Widget> _tabs;
  int? _lastObservedUnreadCount;
  Timer? _unreadRefreshTimer;
  bool _popupScheduled = false;
  bool _announcementPopupScheduled = false;
  final Set<String> _seenAnnouncementIds = <String>{};
  final DoctorUpdateRealtimeService _realtimeService =
      DoctorUpdateRealtimeService();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _currentNavIndex = widget.initialTabIndex.clamp(0, 4);
    _tabs = [
      PatientPage(embedInShell: true, onTabChanged: _onNavChanged),
      PatientUpdateINRPage(embedInShell: true, onTabChanged: _onNavChanged),
      PatientTakeDosagePage(embedInShell: true, onTabChanged: _onNavChanged),
      PatientHealthReportsPage(embedInShell: true, onTabChanged: _onNavChanged),
      PatientProfilePage(embedInShell: true, onTabChanged: _onNavChanged),
    ];
    _unreadRefreshTimer = Timer.periodic(
      const Duration(seconds: 30),
      (_) => _refreshUnreadUpdates(),
    );
    unawaited(
      _realtimeService.start(
        onDoctorUpdate: _handleRealtimeDoctorUpdate,
        onNotification: _handleRealtimeNotification,
      ),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _unreadRefreshTimer?.cancel();
    unawaited(_realtimeService.stop());
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refreshUnreadUpdates();
      _refreshNotificationsUnread();
    }
  }

  @override
  void didUpdateWidget(covariant PatientDashboardShellPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    final newIndex = widget.initialTabIndex.clamp(0, 4);
    if (newIndex != _currentNavIndex) {
      setState(() => _currentNavIndex = newIndex);
    }
  }

  @override
  Widget build(BuildContext context) {
    return UseQuery<int>(
      options: QueryOptions<int>(
        queryKey: PatientQueryKeys.doctorUpdatesUnread(),
        queryFn: () async {
          final summary =
              await AppDependencies.patientRepository.getDoctorUpdatesSummary();
          return (summary['unread_count'] as num?)?.toInt() ?? 0;
        },
      ),
      builder: (context, updatesQuery) {
        final unreadDoctorUpdates = updatesQuery.data ?? 0;
        _maybeShowUnreadPopup(unreadDoctorUpdates);

        return UseQuery<int>(
          options: QueryOptions<int>(
            queryKey: PatientQueryKeys.notificationsUnread(),
            queryFn: () async {
              return AppDependencies.patientRepository
                  .getNotificationsUnreadCount();
            },
          ),
          builder: (context, notificationsQuery) {
            final unreadNotifications = notificationsQuery.data ?? 0;

            return PatientScaffold(
              pageTitle: _titleForIndex(_currentNavIndex),
              currentNavIndex: _currentNavIndex,
              onNavChanged: _onNavChanged,
              unreadDoctorUpdatesCount: unreadDoctorUpdates,
              notificationBadgeCount: unreadNotifications,
              onNotificationPressed: () async {
                await Navigator.of(context).pushNamed(
                  AppRoutes.patientNotifications,
                );
                _refreshUnreadUpdates();
                _refreshNotificationsUnread();
              },
              bodyDecoration: _decorationForIndex(_currentNavIndex),
              body: IndexedStack(
                index: _currentNavIndex,
                children: _tabs,
              ),
            );
          },
        );
      },
    );
  }

  void _onNavChanged(int index) {
    if (index == _currentNavIndex) return;
    setState(() => _currentNavIndex = index);
  }

  void _maybeShowUnreadPopup(int unreadCount) {
    final previousUnread = _lastObservedUnreadCount;
    _lastObservedUnreadCount = unreadCount;
    if (!shouldShowUnreadUpdatesPopup(
      unreadCount: unreadCount,
      previousUnreadCount: previousUnread,
      popupScheduled: _popupScheduled || _announcementPopupScheduled,
    )) {
      return;
    }

    _popupScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;

      showDialog<void>(
        context: context,
        builder: (context) {
          return AlertDialog(
            title: const Text('New Doctor Updates'),
            content: Text(
              unreadCount == 1
                  ? 'You have 1 unread doctor update.'
                  : 'You have $unreadCount unread doctor updates.',
            ),
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.of(context).pop();
                  _popupScheduled = false;
                },
                child: const Text('Later'),
              ),
              FilledButton(
                onPressed: () {
                  Navigator.of(context).pop();
                  _popupScheduled = false;
                  _onNavChanged(4);
                },
                child: const Text('View Updates'),
              ),
            ],
          );
        },
      ).whenComplete(() {
        _popupScheduled = false;
      });
    });
  }

  void _refreshUnreadUpdates() {
    if (!mounted) return;
    final queryClient = QueryClientProvider.of(context);
    queryClient.invalidateQueries(
      PatientQueryKeys.doctorUpdatesUnread(),
    );
  }

  void _refreshNotificationsUnread() {
    if (!mounted) return;
    final queryClient = QueryClientProvider.of(context);
    queryClient.invalidateQueries(
      PatientQueryKeys.notificationsUnread(),
    );
    queryClient.invalidateQueries(
      PatientQueryKeys.notifications(),
    );
  }

  void _handleRealtimeDoctorUpdate() {
    if (!mounted) return;
    final queryClient = QueryClientProvider.of(context);
    queryClient.invalidateQueries(
      PatientQueryKeys.doctorUpdatesUnread(),
    );
    queryClient.invalidateQueries(
      PatientQueryKeys.profileFull(),
    );
    _refreshNotificationsUnread();
  }

  void _handleRealtimeNotification(Map<String, dynamic> notification) {
    if (!mounted) return;
    _refreshNotificationsUnread();

    final id = notification['id']?.toString();
    final type = notification['type']?.toString();

    if (!shouldShowSystemAnnouncementPopup(
      notificationId: id,
      notificationType: type,
      popupScheduled: _popupScheduled || _announcementPopupScheduled,
      seenNotificationIds: _seenAnnouncementIds,
    )) {
      return;
    }

    _announcementPopupScheduled = true;
    _seenAnnouncementIds.add(id!);

    final title = notification['title']?.toString().trim().isNotEmpty == true
        ? notification['title']!.toString()
        : 'System announcement';
    final message = notification['message']?.toString().trim().isNotEmpty == true
        ? notification['message']!.toString()
        : 'You have a new system notification.';

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;

      showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            FilledButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('OK'),
            ),
          ],
        ),
      ).whenComplete(() {
        _announcementPopupScheduled = false;
      });
    });
  }

  String _titleForIndex(int index) {
    switch (index) {
      case 1:
        return 'Update INR';
      case 2:
        return 'Dosage Management';
      case 3:
        return 'Health Reports';
      case 4:
        return 'My Profile';
      case 0:
      default:
        return 'Dashboard';
    }
  }

  Decoration _decorationForIndex(int index) {
    if (index == 4) {
      return const BoxDecoration(color: Color(0xFFF9FAFB));
    }

    return const BoxDecoration(
      gradient: LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [Color(0xFFC8B5E1), Color(0xFFF8C7D7)],
      ),
    );
  }
}
