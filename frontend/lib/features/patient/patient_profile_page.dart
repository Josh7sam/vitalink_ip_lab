import 'package:flutter/material.dart';
import 'package:frontend/core/widgets/index.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/services/patient_service.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';

class PatientProfilePage extends StatefulWidget {
  const PatientProfilePage({super.key});

  @override
  State<PatientProfilePage> createState() => _PatientProfilePageState();
}

class _PatientProfilePageState extends State<PatientProfilePage> {
  final int _currentNavIndex = 4;

  @override
  Widget build(BuildContext context) {
    return UseQuery<Map<String, dynamic>>(
      options: QueryOptions<Map<String, dynamic>>(
        queryKey: const ['patient', 'profile_full'],
        queryFn: () async {
          final profile = await PatientService.getProfile();
          final history = await PatientService.getINRHistory();
          final latest = await PatientService.getLatestINR();
          final doctorUpdates = await PatientService.getDoctorUpdates(limit: 5);
          return {
            'profile': profile,
            'history': history,
            'latest': latest,
            'doctorUpdates': doctorUpdates,
          };
        },
      ),
      builder: (context, query) {
        if (query.isLoading) {
          return PatientScaffold(
            pageTitle: 'My Profile',
            currentNavIndex: _currentNavIndex,
            onNavChanged: (index) => _handleNav(index),
            body: const Center(child: CircularProgressIndicator()),
          );
        }

        if (query.isError) {
          return PatientScaffold(
            pageTitle: 'My Profile',
            currentNavIndex: _currentNavIndex,
            onNavChanged: (index) => _handleNav(index),
            body: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('Error: ${query.error}'),
                  const SizedBox(height: 16),
                  ElevatedButton(onPressed: () => query.refetch(), child: const Text('Retry')),
                ],
              ),
            ),
          );
        }

        if (!query.hasData) {
          return PatientScaffold(
            pageTitle: 'My Profile',
            currentNavIndex: _currentNavIndex,
            onNavChanged: (index) => _handleNav(index),
            body: const Center(child: CircularProgressIndicator()),
          );
        }

        final data = query.data!;
        final profile = data['profile'] as Map<String, dynamic>;
        final doctorUpdates = (data['doctorUpdates'] as List?)?.cast<Map<String, dynamic>>() ?? [];

        return PatientScaffold(
          pageTitle: 'My Profile',
          currentNavIndex: _currentNavIndex,
          onNavChanged: (index) => _handleNav(index),
          bodyDecoration: const BoxDecoration(
            color: Color(0xFFF9FAFB),
          ),
          body: RefreshIndicator(
            onRefresh: () async => query.refetch(),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 32, 20, 40),
              physics: const AlwaysScrollableScrollPhysics(),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Top Section (Avatar, Name, Info Cards, Details, Actions)
                  PatientProfileContent(
                    profile: profile,
                    onProfileUpdated: () => query.refetch(),
                  ),
                  const SizedBox(height: 20),
                  _DoctorUpdatesCard(
                    updates: doctorUpdates,
                    unreadCount: (profile['doctorUpdatesUnreadCount'] as num?)?.toInt() ?? 0,
                  ),

                ],
              ),
            ),
          ),
        );
      },
    );
  }

  void _handleNav(int index) {
    if (index == _currentNavIndex) return;
    switch (index) {
      case 0: Navigator.of(context).pushReplacementNamed(AppRoutes.patient); break;
      case 1: Navigator.of(context).pushReplacementNamed(AppRoutes.patientUpdateINR); break;
      case 2: Navigator.of(context).pushReplacementNamed(AppRoutes.patientTakeDosage); break;
      case 3: Navigator.of(context).pushReplacementNamed(AppRoutes.patientHealthReports); break;
      case 4: break;
    }
  }
}

class _DoctorUpdatesCard extends StatelessWidget {
  const _DoctorUpdatesCard({
    required this.updates,
    required this.unreadCount,
  });

  final List<Map<String, dynamic>> updates;
  final int unreadCount;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.notifications_active_outlined, size: 20, color: Color(0xFF2563EB)),
              const SizedBox(width: 8),
              const Text(
                'Doctor Updates',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
              const Spacer(),
              if (unreadCount > 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEF4444),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '$unreadCount new',
                    style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          if (updates.isEmpty)
            const Text(
              'No recent doctor changes.',
              style: TextStyle(color: Color(0xFF6B7280)),
            )
          else
            ...updates.map((event) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: event['isRead'] == true ? const Color(0xFFF9FAFB) : const Color(0xFFEEF2FF),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          event['title']?.toString() ?? 'Doctor update',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          event['message']?.toString() ?? '',
                          style: const TextStyle(color: Color(0xFF374151), fontSize: 13),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          event['createdAt']?.toString() ?? '',
                          style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                )),
        ],
      ),
    );
  }
}
