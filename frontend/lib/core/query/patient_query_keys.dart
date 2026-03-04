import 'package:frontend/core/di/app_dependencies.dart';

class PatientQueryKeys {
  PatientQueryKeys._();

  static List<Object> all() => ['patient', _scope];

  static List<Object> homeData() => [...all(), 'home_data'];
  static List<Object> profileFull() => [...all(), 'profile_full'];
  static List<Object> recordsFull() => [...all(), 'records_full'];
  static List<Object> missedDoses() => [...all(), 'missed_doses'];
  static List<Object> inrHistory() => [...all(), 'inr_history'];
  static List<Object> doctorUpdatesUnread() =>
      [...all(), 'doctor_updates_unread'];
  static List<Object> notificationsUnread() => [...all(), 'notifications_unread'];
  static List<Object> notifications() => [...all(), 'notifications'];
  static List<Object> dosageCalendar(int months) =>
      [...all(), 'dosage_calendar', months];

  static String get _scope => AppDependencies.secureStorage.sessionScope;
}
