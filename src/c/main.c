/*
 * Eezy für Pebble – Watch-Seite.
 *
 * Die Uhr hat kein Netz. Sie zeigt nur ein Menü (Einloggen / Ausloggen /
 * Status) und schickt den gewählten Befehl per AppMessage an den JS-Teil auf
 * dem Handy (src/pkjs). Der JS-Teil spricht mit Eezy und meldet das Ergebnis
 * als Text (STATUS) und Flag (LOGGED_IN) zurück.
 */
#include <pebble.h>

enum Command {
  CMD_LOGIN = 1,
  CMD_LOGOUT = 2,
  CMD_STATUS = 3,
};

#define STATUS_BAR_HEIGHT 36
#define RESPONSE_TIMEOUT_MS 20000

static Window *s_window;
static TextLayer *s_status_layer;
static MenuLayer *s_menu_layer;
static AppTimer *s_timeout_timer;

static char s_status[96] = "Bereit";
static bool s_logged_in = false;
static bool s_busy = false;

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

static void set_status(const char *text) {
  strncpy(s_status, text, sizeof(s_status) - 1);
  s_status[sizeof(s_status) - 1] = '\0';
  text_layer_set_text(s_status_layer, s_status);
  menu_layer_reload_data(s_menu_layer);
}

static void set_busy(bool busy) {
  s_busy = busy;
  if (s_timeout_timer) {
    app_timer_cancel(s_timeout_timer);
    s_timeout_timer = NULL;
  }
}

static void timeout_handler(void *context) {
  s_timeout_timer = NULL;
  if (s_busy) {
    set_busy(false);
    set_status("Keine Antwort vom Handy");
    vibes_double_pulse();
  }
}

/* ------------------------------------------------------------------ */
/* AppMessage                                                          */
/* ------------------------------------------------------------------ */

static void send_command(enum Command cmd) {
  if (s_busy) {
    return;
  }

  DictionaryIterator *iter;
  AppMessageResult result = app_message_outbox_begin(&iter);
  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "outbox_begin fehlgeschlagen: %d", (int)result);
    set_status("Handy nicht erreichbar");
    return;
  }

  dict_write_int32(iter, MESSAGE_KEY_CMD, (int32_t)cmd);
  dict_write_end(iter);

  result = app_message_outbox_send();
  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "outbox_send fehlgeschlagen: %d", (int)result);
    set_status("Senden fehlgeschlagen");
    return;
  }

  set_busy(true);
  s_timeout_timer = app_timer_register(RESPONSE_TIMEOUT_MS, timeout_handler, NULL);

  switch (cmd) {
    case CMD_LOGIN:  set_status("Logge ein ..."); break;
    case CMD_LOGOUT: set_status("Logge aus ..."); break;
    default:         set_status("Frage Status ab ..."); break;
  }
}

static void inbox_received_handler(DictionaryIterator *iter, void *context) {
  Tuple *logged_in = dict_find(iter, MESSAGE_KEY_LOGGED_IN);
  if (logged_in) {
    s_logged_in = logged_in->value->int32 != 0;
  }

  Tuple *status = dict_find(iter, MESSAGE_KEY_STATUS);
  if (status) {
    set_busy(false);
    set_status(status->value->cstring);
    vibes_short_pulse();
  } else {
    menu_layer_reload_data(s_menu_layer);
  }
}

static void inbox_dropped_handler(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "Nachricht verworfen: %d", (int)reason);
}

static void outbox_failed_handler(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Senden fehlgeschlagen: %d", (int)reason);
  set_busy(false);
  set_status("Senden fehlgeschlagen");
}

/* ------------------------------------------------------------------ */
/* Menü                                                                */
/* ------------------------------------------------------------------ */

enum MenuRow {
  ROW_LOGIN = 0,
  ROW_LOGOUT,
  ROW_STATUS,
  ROW_COUNT,
};

static uint16_t menu_get_num_rows(MenuLayer *menu_layer, uint16_t section_index, void *context) {
  return ROW_COUNT;
}

static void menu_draw_row(GContext *ctx, const Layer *cell_layer, MenuIndex *cell_index, void *context) {
  switch (cell_index->row) {
    case ROW_LOGIN:
      menu_cell_basic_draw(ctx, cell_layer, "Einloggen",
                           s_logged_in ? "bereits eingeloggt" : NULL, NULL);
      break;
    case ROW_LOGOUT:
      menu_cell_basic_draw(ctx, cell_layer, "Ausloggen",
                           s_logged_in ? NULL : "nicht eingeloggt", NULL);
      break;
    case ROW_STATUS:
      menu_cell_basic_draw(ctx, cell_layer, "Status",
                           s_logged_in ? "eingeloggt" : "ausgeloggt", NULL);
      break;
  }
}

static void menu_select_click(MenuLayer *menu_layer, MenuIndex *cell_index, void *context) {
  switch (cell_index->row) {
    case ROW_LOGIN:  send_command(CMD_LOGIN);  break;
    case ROW_LOGOUT: send_command(CMD_LOGOUT); break;
    case ROW_STATUS: send_command(CMD_STATUS); break;
  }
}

/* ------------------------------------------------------------------ */
/* Fenster                                                             */
/* ------------------------------------------------------------------ */

static void window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  s_status_layer = text_layer_create(GRect(0, 0, bounds.size.w, STATUS_BAR_HEIGHT));
  text_layer_set_font(s_status_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_status_layer, GTextAlignmentCenter);
  text_layer_set_overflow_mode(s_status_layer, GTextOverflowModeTrailingEllipsis);
  text_layer_set_background_color(s_status_layer, GColorBlack);
  text_layer_set_text_color(s_status_layer, GColorWhite);
  text_layer_set_text(s_status_layer, s_status);
  layer_add_child(window_layer, text_layer_get_layer(s_status_layer));

  GRect menu_bounds = GRect(0, STATUS_BAR_HEIGHT, bounds.size.w, bounds.size.h - STATUS_BAR_HEIGHT);
  s_menu_layer = menu_layer_create(menu_bounds);
  menu_layer_set_callbacks(s_menu_layer, NULL, (MenuLayerCallbacks) {
    .get_num_rows = menu_get_num_rows,
    .draw_row = menu_draw_row,
    .select_click = menu_select_click,
  });
  menu_layer_set_click_config_onto_window(s_menu_layer, window);
  layer_add_child(window_layer, menu_layer_get_layer(s_menu_layer));
}

static void window_unload(Window *window) {
  menu_layer_destroy(s_menu_layer);
  text_layer_destroy(s_status_layer);
}

static void init(void) {
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = window_load,
    .unload = window_unload,
  });

  app_message_register_inbox_received(inbox_received_handler);
  app_message_register_inbox_dropped(inbox_dropped_handler);
  app_message_register_outbox_failed(outbox_failed_handler);
  app_message_open(256, 64);

  window_stack_push(s_window, true);
}

static void deinit(void) {
  if (s_timeout_timer) {
    app_timer_cancel(s_timeout_timer);
  }
  window_destroy(s_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
