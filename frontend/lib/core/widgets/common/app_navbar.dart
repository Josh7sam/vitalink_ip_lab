import 'package:flutter/material.dart';

class AppNavBar extends StatelessWidget {
  final String pageTitle;
  final VoidCallback? onMenuPressed;
  final VoidCallback? onNotificationPressed;
  final int notificationBadgeCount;
  final Color backgroundColor;

  const AppNavBar({
    super.key,
    required this.pageTitle,
    this.onMenuPressed,
    this.onNotificationPressed,
    this.notificationBadgeCount = 0,
    this.backgroundColor = Colors.white,
  });

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    final horizontal = (size.width * 0.06).clamp(12.0, 32.0);
    final logoHeight = size.width < 340
        ? 52.0
        : size.width < 480
            ? 64.0
            : 76.0;
    final dividerHeight = (logoHeight * 0.85).clamp(42.0, 68.0);
    final gap = (size.width * 0.035).clamp(8.0, 16.0);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: double.infinity,
          decoration: BoxDecoration(
            color: backgroundColor,
            borderRadius: const BorderRadius.only(
              bottomLeft: Radius.circular(24),
              bottomRight: Radius.circular(24),
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.07),
                blurRadius: 14,
                spreadRadius: 1,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          padding: EdgeInsets.symmetric(
            vertical: 14,
            horizontal: horizontal,
          ),
          child: SafeArea(
            bottom: false,
            child: Stack(
              children: [
                Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Flexible(
                          flex: 1,
                          child: Align(
                            alignment: Alignment.centerRight,
                            child: SizedBox(
                              height: logoHeight,
                              child: Image.asset(
                                'assets/images/psg_ims.png',
                                fit: BoxFit.contain,
                              ),
                            ),
                          ),
                        ),
                        SizedBox(width: gap),
                        Container(
                          width: 1,
                          height: dividerHeight,
                          color: Colors.grey.shade300,
                        ),
                        SizedBox(width: gap),
                        Flexible(
                          flex: 1,
                          child: Align(
                            alignment: Alignment.centerLeft,
                            child: SizedBox(
                              height: logoHeight,
                              child: Image.asset(
                                'assets/images/psg_logo_2.jpg.jpeg',
                                fit: BoxFit.contain,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      pageTitle,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: Colors.black87,
                      ),
                    ),
                  ],
                ),
                if (onNotificationPressed != null)
                  Positioned(
                    right: 0,
                    top: 0,
                    child: Stack(
                      clipBehavior: Clip.none,
                      children: [
                        IconButton(
                          onPressed: onNotificationPressed,
                          icon: const Icon(Icons.notifications_outlined),
                          tooltip: 'Notifications',
                        ),
                        if (notificationBadgeCount > 0)
                          Positioned(
                            right: 8,
                            top: 6,
                            child: Container(
                              constraints: const BoxConstraints(
                                minWidth: 16,
                                minHeight: 16,
                              ),
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 4),
                              decoration: const BoxDecoration(
                                color: Color(0xFFDC2626),
                                shape: BoxShape.rectangle,
                                borderRadius:
                                    BorderRadius.all(Radius.circular(10)),
                              ),
                              child: Center(
                                child: Text(
                                  notificationBadgeCount > 99
                                      ? '99+'
                                      : notificationBadgeCount.toString(),
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
