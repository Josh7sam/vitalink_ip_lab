import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/doctor_query_keys.dart';
import 'package:frontend/core/query/patient_query_keys.dart';

class NotificationCenterPage extends StatefulWidget {
  const NotificationCenterPage({
    super.key,
    required this.forDoctor,
  });

  final bool forDoctor;

  @override
  State<NotificationCenterPage> createState() => _NotificationCenterPageState();
}

class _NotificationCenterPageState extends State<NotificationCenterPage> {
  bool _markAllLoading = false;

  @override
  Widget build(BuildContext context) {
    return UseQuery<Map<String, dynamic>>(
      options: QueryOptions<Map<String, dynamic>>(
        queryKey: widget.forDoctor
            ? DoctorQueryKeys.notifications()
            : PatientQueryKeys.notifications(),
        queryFn: () {
          if (widget.forDoctor) {
            return AppDependencies.doctorRepository.getNotifications(limit: 50);
          }
          return AppDependencies.patientRepository.getNotifications(limit: 50);
        },
      ),
      builder: (context, query) {
        final data = query.data ?? <String, dynamic>{};
        final notifications =
            (data['notifications'] as List?)?.cast<Map<String, dynamic>>() ??
                <Map<String, dynamic>>[];
        final unreadCount = (data['unreadCount'] as num?)?.toInt() ?? 0;

        return Scaffold(
          appBar: AppBar(
            title: const Text('Notifications'),
            actions: [
              TextButton(
                onPressed: (!_markAllLoading && unreadCount > 0)
                    ? () => _markAllAsRead(query.refetch)
                    : null,
                child: _markAllLoading
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Mark all read'),
              ),
            ],
          ),
          body: query.isLoading
              ? const Center(child: CircularProgressIndicator())
              : query.isError
                  ? _ErrorState(
                      message: query.error.toString(),
                      onRetry: () => query.refetch(),
                    )
                  : notifications.isEmpty
                      ? const _EmptyState()
                      : RefreshIndicator(
                          onRefresh: () async => query.refetch(),
                          child: ListView.separated(
                            padding: const EdgeInsets.all(12),
                            itemCount: notifications.length,
                            separatorBuilder: (_, __) =>
                                const SizedBox(height: 10),
                            itemBuilder: (context, index) {
                              final item = notifications[index];
                              return _NotificationTile(
                                item: item,
                                onTap: () => _markSingleAsReadIfNeeded(
                                  item,
                                  query.refetch,
                                ),
                              );
                            },
                          ),
                        ),
        );
      },
    );
  }

  Future<void> _markSingleAsReadIfNeeded(
    Map<String, dynamic> item,
    Future<void> Function() refetch,
  ) async {
    if (item['isRead'] == true) return;
    final id = item['id']?.toString() ?? '';
    if (id.isEmpty) return;

    if (widget.forDoctor) {
      await AppDependencies.doctorRepository.markNotificationAsRead(id);
    } else {
      await AppDependencies.patientRepository.markNotificationAsRead(id);
    }
    await _invalidateNotificationKeys();
    await refetch();
  }

  Future<void> _markAllAsRead(Future<void> Function() refetch) async {
    setState(() => _markAllLoading = true);
    try {
      if (widget.forDoctor) {
        await AppDependencies.doctorRepository.markAllNotificationsAsRead();
      } else {
        await AppDependencies.patientRepository.markAllNotificationsAsRead();
      }
      await _invalidateNotificationKeys();
      await refetch();
    } finally {
      if (mounted) setState(() => _markAllLoading = false);
    }
  }

  Future<void> _invalidateNotificationKeys() async {
    final queryClient = QueryClientProvider.of(context);
    if (widget.forDoctor) {
      queryClient.invalidateQueries(DoctorQueryKeys.notifications());
      queryClient.invalidateQueries(DoctorQueryKeys.notificationsUnread());
      return;
    }

    queryClient.invalidateQueries(PatientQueryKeys.notifications());
    queryClient.invalidateQueries(PatientQueryKeys.notificationsUnread());
    queryClient.invalidateQueries(PatientQueryKeys.doctorUpdatesUnread());
    queryClient.invalidateQueries(PatientQueryKeys.profileFull());
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({
    required this.item,
    required this.onTap,
  });

  final Map<String, dynamic> item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final isRead = item['isRead'] == true;
    final priority = item['priority']?.toString() ?? 'MEDIUM';

    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: isRead ? Colors.white : const Color(0xFFF3F4FF),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFFE5E7EB)),
        ),
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    item['title']?.toString() ?? 'Notification',
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                    ),
                  ),
                ),
                if (!isRead)
                  Container(
                    width: 8,
                    height: 8,
                    decoration: const BoxDecoration(
                      color: Color(0xFF2563EB),
                      shape: BoxShape.circle,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              item['message']?.toString() ?? '',
              style: const TextStyle(color: Color(0xFF374151)),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                _PriorityChip(priority: priority),
                const Spacer(),
                Text(
                  item['createdAt']?.toString() ?? '',
                  style: const TextStyle(
                    color: Color(0xFF9CA3AF),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PriorityChip extends StatelessWidget {
  const _PriorityChip({required this.priority});
  final String priority;

  @override
  Widget build(BuildContext context) {
    final color = switch (priority) {
      'URGENT' => const Color(0xFFDC2626),
      'HIGH' => const Color(0xFFEA580C),
      'LOW' => const Color(0xFF059669),
      _ => const Color(0xFF2563EB),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        priority,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Text(
        'No notifications yet.',
        style: TextStyle(color: Color(0xFF6B7280)),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({
    required this.message,
    required this.onRetry,
  });

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            message,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 10),
          FilledButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}
