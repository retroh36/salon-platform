
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "ai_actions": {
                  Row: {
                    "business_id": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"feature": string,"id": string,"location_id": string,"previous_state": Json | null,"proposal": NonNullable<Json>,"proposed_by": string | null,"rank": number,"reason": string,"status": Database["public"]['Enums']["ai_action_status"],"subject": string | null,"summary": string,"undone_at": string | null,"undone_by": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"feature": string,"id"?: string,"location_id": string,"previous_state"?: Json | null,"proposal": NonNullable<Json>,"proposed_by"?: string | null,"rank"?: number,"reason": string,"status"?: Database["public"]['Enums']["ai_action_status"],"subject"?: string | null,"summary": string,"undone_at"?: string | null,"undone_by"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"feature"?: string,"id"?: string,"location_id"?: string,"previous_state"?: Json | null,"proposal"?: NonNullable<Json>,"proposed_by"?: string | null,"rank"?: number,"reason"?: string,"status"?: Database["public"]['Enums']["ai_action_status"],"subject"?: string | null,"summary"?: string,"undone_at"?: string | null,"undone_by"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_actions_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_actions_decided_by_business_id_fkey"
      columns: ["decided_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "ai_actions_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "ai_actions_proposed_by_business_id_fkey"
      columns: ["proposed_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "ai_actions_undone_by_business_id_fkey"
      columns: ["undone_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"ai_usage": {
                  Row: {
                    "business_id": string,"cache_read_tokens": number,"day": string,"feature": string,"input_tokens": number,"model": string,"output_tokens": number,"requests": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"cache_read_tokens"?: number,"day": string,"feature": string,"input_tokens"?: number,"model": string,"output_tokens"?: number,"requests"?: number
                  }
                  Update: {
                    "business_id"?: string,"cache_read_tokens"?: number,"day"?: string,"feature"?: string,"input_tokens"?: number,"model"?: string,"output_tokens"?: number,"requests"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_usage_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"appointment_events": {
                  Row: {
                    "appointment_id": string,"business_id": string,"created_at": string,"detail": NonNullable<Json>,"id": string,"kind": string,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id": string,"business_id": string,"created_at"?: string,"detail"?: NonNullable<Json>,"id"?: string,"kind": string,"staff_id"?: string | null
                  }
                  Update: {
                    "appointment_id"?: string,"business_id"?: string,"created_at"?: string,"detail"?: NonNullable<Json>,"id"?: string,"kind"?: string,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointment_events_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointment_events_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointment_events_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"appointment_groups": {
                  Row: {
                    "business_id": string,"created_at": string,"created_by": string | null,"id": string,"label": string,"location_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"label": string,"location_id": string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"label"?: string,"location_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointment_groups_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointment_groups_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointment_groups_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"appointment_items": {
                  Row: {
                    "active_minutes": number,"appointment_id": string,"business_id": string,"created_at": string,"ends_at": string,"finished_at": string | null,"finishing_minutes": number,"id": string,"location_id": string,"price_cents": number,"processing_ended_at": string | null,"processing_minutes": number,"processing_started_at": string | null,"resource_id": string | null,"service_id": string,"staff_id": string,"started_at": string | null,"starts_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active_minutes": number,"appointment_id": string,"business_id": string,"created_at"?: string,"ends_at": string,"finished_at"?: string | null,"finishing_minutes"?: number,"id"?: string,"location_id": string,"price_cents": number,"processing_ended_at"?: string | null,"processing_minutes"?: number,"processing_started_at"?: string | null,"resource_id"?: string | null,"service_id": string,"staff_id": string,"started_at"?: string | null,"starts_at": string,"updated_at"?: string
                  }
                  Update: {
                    "active_minutes"?: number,"appointment_id"?: string,"business_id"?: string,"created_at"?: string,"ends_at"?: string,"finished_at"?: string | null,"finishing_minutes"?: number,"id"?: string,"location_id"?: string,"price_cents"?: number,"processing_ended_at"?: string | null,"processing_minutes"?: number,"processing_started_at"?: string | null,"resource_id"?: string | null,"service_id"?: string,"staff_id"?: string,"started_at"?: string | null,"starts_at"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointment_items_appointment_id_business_id_location_id_fkey"
      columns: ["appointment_id","business_id","location_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id","business_id","location_id"]
    },{
      foreignKeyName: "appointment_items_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointment_items_resource_id_location_id_fkey"
      columns: ["resource_id","location_id"]
isOneToOne: false
      referencedRelation: "resources"
      referencedColumns: ["id","location_id"]
    },{
      foreignKeyName: "appointment_items_service_id_business_id_fkey"
      columns: ["service_id","business_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointment_items_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"appointment_series": {
                  Row: {
                    "business_id": string,"client_id": string | null,"created_at": string,"created_by": string | null,"ends_on": string | null,"id": string,"interval_weeks": number,"location_id": string,"occurrences": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"ends_on"?: string | null,"id"?: string,"interval_weeks": number,"location_id": string,"occurrences"?: number | null
                  }
                  Update: {
                    "business_id"?: string,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"ends_on"?: string | null,"id"?: string,"interval_weeks"?: number,"location_id"?: string,"occurrences"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointment_series_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointment_series_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointment_series_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointment_series_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"appointments": {
                  Row: {
                    "business_id": string,"cancel_reason": string | null,"canceled_at": string | null,"checked_in_at": string | null,"checked_out_at": string | null,"client_id": string | null,"created_at": string,"created_by": string | null,"deposit_cents": number,"ends_at": string,"group_id": string | null,"id": string,"location_id": string,"manage_token_hash": string | null,"notes": string | null,"online_source": string | null,"series_id": string | null,"series_index": number | null,"source": Database["public"]['Enums']["appointment_source"],"starts_at": string,"status": Database["public"]['Enums']["appointment_status"],"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"cancel_reason"?: string | null,"canceled_at"?: string | null,"checked_in_at"?: string | null,"checked_out_at"?: string | null,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deposit_cents"?: number,"ends_at": string,"group_id"?: string | null,"id"?: string,"location_id": string,"manage_token_hash"?: string | null,"notes"?: string | null,"online_source"?: string | null,"series_id"?: string | null,"series_index"?: number | null,"source"?: Database["public"]['Enums']["appointment_source"],"starts_at": string,"status"?: Database["public"]['Enums']["appointment_status"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"cancel_reason"?: string | null,"canceled_at"?: string | null,"checked_in_at"?: string | null,"checked_out_at"?: string | null,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deposit_cents"?: number,"ends_at"?: string,"group_id"?: string | null,"id"?: string,"location_id"?: string,"manage_token_hash"?: string | null,"notes"?: string | null,"online_source"?: string | null,"series_id"?: string | null,"series_index"?: number | null,"source"?: Database["public"]['Enums']["appointment_source"],"starts_at"?: string,"status"?: Database["public"]['Enums']["appointment_status"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointments_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointments_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointments_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointments_group_id_business_id_fkey"
      columns: ["group_id","business_id"]
isOneToOne: false
      referencedRelation: "appointment_groups"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointments_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointments_series_id_business_id_fkey"
      columns: ["series_id","business_id"]
isOneToOne: false
      referencedRelation: "appointment_series"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointments_updated_by_business_id_fkey"
      columns: ["updated_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"businesses": {
                  Row: {
                    "ai_daily_token_limit": number,"created_at": string,"discount_max_percent": number,"discount_roles": (Database["public"]['Enums']["staff_role"])[],"gift_card_expiry_months": number | null,"gift_card_presets_cents": (number)[],"google_review_url": string | null,"id": string,"logo_path": string | null,"name": string,"next_sale_number": number,"patch_test_enforcement": string,"patch_test_min_hours": number,"patch_test_valid_days": number,"pay_period": string,"pay_period_anchor": string,"plan": string,"promo_card_expiry_days": number,"receipt_footer": string | null,"receipt_show_stylists": boolean,"settings": NonNullable<Json>,"slug": string | null,"tax_rate_retail_bp": number,"tax_rate_services_bp": number,"updated_at": string,"yelp_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_daily_token_limit"?: number,"created_at"?: string,"discount_max_percent"?: number,"discount_roles"?: (Database["public"]['Enums']["staff_role"])[],"gift_card_expiry_months"?: number | null,"gift_card_presets_cents"?: (number)[],"google_review_url"?: string | null,"id"?: string,"logo_path"?: string | null,"name": string,"next_sale_number"?: number,"patch_test_enforcement"?: string,"patch_test_min_hours"?: number,"patch_test_valid_days"?: number,"pay_period"?: string,"pay_period_anchor"?: string,"plan"?: string,"promo_card_expiry_days"?: number,"receipt_footer"?: string | null,"receipt_show_stylists"?: boolean,"settings"?: NonNullable<Json>,"slug"?: string | null,"tax_rate_retail_bp"?: number,"tax_rate_services_bp"?: number,"updated_at"?: string,"yelp_url"?: string | null
                  }
                  Update: {
                    "ai_daily_token_limit"?: number,"created_at"?: string,"discount_max_percent"?: number,"discount_roles"?: (Database["public"]['Enums']["staff_role"])[],"gift_card_expiry_months"?: number | null,"gift_card_presets_cents"?: (number)[],"google_review_url"?: string | null,"id"?: string,"logo_path"?: string | null,"name"?: string,"next_sale_number"?: number,"patch_test_enforcement"?: string,"patch_test_min_hours"?: number,"patch_test_valid_days"?: number,"pay_period"?: string,"pay_period_anchor"?: string,"plan"?: string,"promo_card_expiry_days"?: number,"receipt_footer"?: string | null,"receipt_show_stylists"?: boolean,"settings"?: NonNullable<Json>,"slug"?: string | null,"tax_rate_retail_bp"?: number,"tax_rate_services_bp"?: number,"updated_at"?: string,"yelp_url"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"cash_closeouts": {
                  Row: {
                    "business_id": string,"closed_at": string,"closed_by": string | null,"counted_cents": number,"day": string,"expected_cents": number,"id": string,"location_id": string,"note": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"closed_at"?: string,"closed_by"?: string | null,"counted_cents": number,"day": string,"expected_cents": number,"id"?: string,"location_id": string,"note"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"closed_at"?: string,"closed_by"?: string | null,"counted_cents"?: number,"day"?: string,"expected_cents"?: number,"id"?: string,"location_id"?: string,"note"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "cash_closeouts_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cash_closeouts_closed_by_business_id_fkey"
      columns: ["closed_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "cash_closeouts_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"client_forms": {
                  Row: {
                    "answers": NonNullable<Json>,"business_id": string,"client_id": string,"collected_by": string | null,"fields": NonNullable<Json>,"id": string,"signature": string | null,"signed_at": string,"template_id": string | null,"template_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answers": NonNullable<Json>,"business_id": string,"client_id": string,"collected_by"?: string | null,"fields": NonNullable<Json>,"id"?: string,"signature"?: string | null,"signed_at"?: string,"template_id"?: string | null,"template_name": string
                  }
                  Update: {
                    "answers"?: NonNullable<Json>,"business_id"?: string,"client_id"?: string,"collected_by"?: string | null,"fields"?: NonNullable<Json>,"id"?: string,"signature"?: string | null,"signed_at"?: string,"template_id"?: string | null,"template_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_forms_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_forms_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "client_forms_collected_by_business_id_fkey"
      columns: ["collected_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "client_forms_template_id_business_id_fkey"
      columns: ["template_id","business_id"]
isOneToOne: false
      referencedRelation: "form_templates"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"client_formulas": {
                  Row: {
                    "appointment_item_id": string | null,"business_id": string,"client_id": string,"created_at": string,"formula": string,"id": string,"notes": string | null,"staff_id": string,"visit_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_item_id"?: string | null,"business_id": string,"client_id": string,"created_at"?: string,"formula": string,"id"?: string,"notes"?: string | null,"staff_id": string,"visit_date"?: string
                  }
                  Update: {
                    "appointment_item_id"?: string | null,"business_id"?: string,"client_id"?: string,"created_at"?: string,"formula"?: string,"id"?: string,"notes"?: string | null,"staff_id"?: string,"visit_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_formulas_appointment_item_id_fkey"
      columns: ["appointment_item_id"]
isOneToOne: false
      referencedRelation: "appointment_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_formulas_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_formulas_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "client_formulas_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"client_memberships": {
                  Row: {
                    "allow_pause": boolean,"anchor_on": string,"business_id": string,"cancel_notice_days": number,"cancel_reason": string | null,"canceled_at": string | null,"cancels_on": string | null,"card_label": string | null,"client_id": string,"created_at": string,"created_by": string | null,"current_period_end": string,"current_period_start": string,"failed_attempts": number,"id": string,"interval_count": number,"interval_unit": string,"location_id": string,"max_pause_periods": number,"min_term_periods": number,"name": string,"next_retry_at": string | null,"pause_from": string | null,"payment_method_ref": string,"periods_paid": number,"plan_id": string | null,"price_cents": number,"provider": string,"resume_on": string | null,"retail_discount_pct": number,"sale_id": string | null,"service_discount_pct": number,"started_on": string,"status": Database["public"]['Enums']["membership_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "allow_pause"?: boolean,"anchor_on": string,"business_id": string,"cancel_notice_days"?: number,"cancel_reason"?: string | null,"canceled_at"?: string | null,"cancels_on"?: string | null,"card_label"?: string | null,"client_id": string,"created_at"?: string,"created_by"?: string | null,"current_period_end": string,"current_period_start": string,"failed_attempts"?: number,"id"?: string,"interval_count": number,"interval_unit": string,"location_id": string,"max_pause_periods"?: number,"min_term_periods"?: number,"name": string,"next_retry_at"?: string | null,"pause_from"?: string | null,"payment_method_ref": string,"periods_paid"?: number,"plan_id"?: string | null,"price_cents": number,"provider"?: string,"resume_on"?: string | null,"retail_discount_pct"?: number,"sale_id"?: string | null,"service_discount_pct"?: number,"started_on": string,"status"?: Database["public"]['Enums']["membership_status"]
                  }
                  Update: {
                    "allow_pause"?: boolean,"anchor_on"?: string,"business_id"?: string,"cancel_notice_days"?: number,"cancel_reason"?: string | null,"canceled_at"?: string | null,"cancels_on"?: string | null,"card_label"?: string | null,"client_id"?: string,"created_at"?: string,"created_by"?: string | null,"current_period_end"?: string,"current_period_start"?: string,"failed_attempts"?: number,"id"?: string,"interval_count"?: number,"interval_unit"?: string,"location_id"?: string,"max_pause_periods"?: number,"min_term_periods"?: number,"name"?: string,"next_retry_at"?: string | null,"pause_from"?: string | null,"payment_method_ref"?: string,"periods_paid"?: number,"plan_id"?: string | null,"price_cents"?: number,"provider"?: string,"resume_on"?: string | null,"retail_discount_pct"?: number,"sale_id"?: string | null,"service_discount_pct"?: number,"started_on"?: string,"status"?: Database["public"]['Enums']["membership_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_memberships_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_memberships_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_memberships_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_memberships_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_memberships_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "membership_plans"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_memberships_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"client_package_items": {
                  Row: {
                    "business_id": string,"client_package_id": string,"id": string,"service_id": string,"total": number,"use_value_cents": number,"used": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"client_package_id": string,"id"?: string,"service_id": string,"total": number,"use_value_cents": number,"used"?: number
                  }
                  Update: {
                    "business_id"?: string,"client_package_id"?: string,"id"?: string,"service_id"?: string,"total"?: number,"use_value_cents"?: number,"used"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_package_items_client_package_id_business_id_fkey"
      columns: ["client_package_id","business_id"]
isOneToOne: false
      referencedRelation: "client_packages"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "client_package_items_service_id_fkey"
      columns: ["service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id"]
    }
                  ]
                },"client_packages": {
                  Row: {
                    "business_id": string,"cancel_reason": string | null,"canceled_at": string | null,"canceled_by": string | null,"client_id": string,"created_at": string,"created_by": string | null,"expires_at": string | null,"id": string,"levels": (Database["public"]['Enums']["staff_level"])[] | null,"name": string,"price_cents": number,"refunded_cents": number,"sale_id": string | null,"status": Database["public"]['Enums']["client_package_status"],"template_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"cancel_reason"?: string | null,"canceled_at"?: string | null,"canceled_by"?: string | null,"client_id": string,"created_at"?: string,"created_by"?: string | null,"expires_at"?: string | null,"id"?: string,"levels"?: (Database["public"]['Enums']["staff_level"])[] | null,"name": string,"price_cents": number,"refunded_cents"?: number,"sale_id"?: string | null,"status"?: Database["public"]['Enums']["client_package_status"],"template_id"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"cancel_reason"?: string | null,"canceled_at"?: string | null,"canceled_by"?: string | null,"client_id"?: string,"created_at"?: string,"created_by"?: string | null,"expires_at"?: string | null,"id"?: string,"levels"?: (Database["public"]['Enums']["staff_level"])[] | null,"name"?: string,"price_cents"?: number,"refunded_cents"?: number,"sale_id"?: string | null,"status"?: Database["public"]['Enums']["client_package_status"],"template_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_packages_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_packages_canceled_by_business_id_fkey"
      columns: ["canceled_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "client_packages_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_packages_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "client_packages_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_packages_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "package_templates"
      referencedColumns: ["id"]
    }
                  ]
                },"client_patch_tests": {
                  Row: {
                    "business_id": string,"client_id": string,"created_at": string,"id": string,"notes": string | null,"performed_by": string,"products": string,"result": Database["public"]['Enums']["patch_test_result"],"tested_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"client_id": string,"created_at"?: string,"id"?: string,"notes"?: string | null,"performed_by": string,"products": string,"result": Database["public"]['Enums']["patch_test_result"],"tested_at": string
                  }
                  Update: {
                    "business_id"?: string,"client_id"?: string,"created_at"?: string,"id"?: string,"notes"?: string | null,"performed_by"?: string,"products"?: string,"result"?: Database["public"]['Enums']["patch_test_result"],"tested_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_patch_tests_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_patch_tests_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "client_patch_tests_performed_by_business_id_fkey"
      columns: ["performed_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"clients": {
                  Row: {
                    "allergies": string | null,"birth_day": number | null,"birth_month": number | null,"business_id": string,"consent_signed_on": string | null,"created_at": string,"email": string | null,"email_opt_in": boolean,"first_name": string,"id": string,"last_name": string,"notes": string | null,"phone": string | null,"phone_digits": string | null,"photo_consent_by": string | null,"photo_consent_on": string | null,"preferences": string | null,"preferred_staff_id": string | null,"search_name": string | null,"sms_opt_in": boolean,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allergies"?: string | null,"birth_day"?: number | null,"birth_month"?: number | null,"business_id": string,"consent_signed_on"?: string | null,"created_at"?: string,"email"?: string | null,"email_opt_in"?: boolean,"first_name": string,"id"?: string,"last_name"?: string,"notes"?: string | null,"phone"?: string | null,"phone_digits"?: never,"photo_consent_by"?: string | null,"photo_consent_on"?: string | null,"preferences"?: string | null,"preferred_staff_id"?: string | null,"search_name"?: never,"sms_opt_in"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "allergies"?: string | null,"birth_day"?: number | null,"birth_month"?: number | null,"business_id"?: string,"consent_signed_on"?: string | null,"created_at"?: string,"email"?: string | null,"email_opt_in"?: boolean,"first_name"?: string,"id"?: string,"last_name"?: string,"notes"?: string | null,"phone"?: string | null,"phone_digits"?: never,"photo_consent_by"?: string | null,"photo_consent_on"?: string | null,"preferences"?: string | null,"preferred_staff_id"?: string | null,"search_name"?: never,"sms_opt_in"?: boolean,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "clients_photo_consent_by_fkey"
      columns: ["photo_consent_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "clients_preferred_staff_id_business_id_fkey"
      columns: ["preferred_staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"data_exports": {
                  Row: {
                    "business_id": string,"bytes": number,"created_at": string,"id": string,"row_counts": NonNullable<Json>,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"bytes": number,"created_at"?: string,"id"?: string,"row_counts": NonNullable<Json>,"staff_id"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"bytes"?: number,"created_at"?: string,"id"?: string,"row_counts"?: NonNullable<Json>,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "data_exports_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "data_exports_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"denise_briefs": {
                  Row: {
                    "created_at": string,"day": string,"facts_hash": string,"location_id": string,"model": string,"text": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"day": string,"facts_hash": string,"location_id": string,"model": string,"text": string
                  }
                  Update: {
                    "created_at"?: string,"day"?: string,"facts_hash"?: string,"location_id"?: string,"model"?: string,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "denise_briefs_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    }
                  ]
                },"denise_dismissals": {
                  Row: {
                    "business_id": string,"created_at": string,"day": string,"dismissed_by": string | null,"id": string,"item_key": string,"location_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"day": string,"dismissed_by"?: string | null,"id"?: string,"item_key": string,"location_id": string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"day"?: string,"dismissed_by"?: string | null,"id"?: string,"item_key"?: string,"location_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "denise_dismissals_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "denise_dismissals_dismissed_by_business_id_fkey"
      columns: ["dismissed_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "denise_dismissals_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"form_templates": {
                  Row: {
                    "business_id": string,"created_at": string,"fields": NonNullable<Json>,"id": string,"intro": string | null,"is_active": boolean,"name": string,"required": Database["public"]['Enums']["form_requirement"],"service_ids": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"fields": NonNullable<Json>,"id"?: string,"intro"?: string | null,"is_active"?: boolean,"name": string,"required"?: Database["public"]['Enums']["form_requirement"],"service_ids"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"fields"?: NonNullable<Json>,"id"?: string,"intro"?: string | null,"is_active"?: boolean,"name"?: string,"required"?: Database["public"]['Enums']["form_requirement"],"service_ids"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "form_templates_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"formula_products": {
                  Row: {
                    "amount": number,"business_id": string,"formula_id": string,"id": string,"position": number,"product_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"business_id": string,"formula_id": string,"id"?: string,"position"?: number,"product_id": string
                  }
                  Update: {
                    "amount"?: number,"business_id"?: string,"formula_id"?: string,"id"?: string,"position"?: number,"product_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "formula_products_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "formula_products_formula_id_fkey"
      columns: ["formula_id"]
isOneToOne: false
      referencedRelation: "client_formulas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "formula_products_product_id_business_id_fkey"
      columns: ["product_id","business_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"gift_card_events": {
                  Row: {
                    "amount_cents": number,"balance_after": number,"business_id": string,"card_id": string,"created_at": string,"id": string,"kind": string,"reason": string | null,"sale_id": string | null,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"balance_after": number,"business_id": string,"card_id": string,"created_at"?: string,"id"?: string,"kind": string,"reason"?: string | null,"sale_id"?: string | null,"staff_id"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"balance_after"?: number,"business_id"?: string,"card_id"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"reason"?: string | null,"sale_id"?: string | null,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "gift_card_events_card_id_business_id_fkey"
      columns: ["card_id","business_id"]
isOneToOne: false
      referencedRelation: "gift_cards"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "gift_card_events_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gift_card_events_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"gift_card_lookups": {
                  Row: {
                    "business_id": string,"code_hint": string | null,"created_at": string,"found": boolean,"id": string,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"code_hint"?: string | null,"created_at"?: string,"found": boolean,"id"?: string,"staff_id"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"code_hint"?: string | null,"created_at"?: string,"found"?: boolean,"id"?: string,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "gift_card_lookups_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"gift_cards": {
                  Row: {
                    "balance_cents": number,"business_id": string,"client_id": string | null,"code": string,"created_at": string,"created_by": string | null,"expires_at": string | null,"id": string,"imported": boolean,"initial_cents": number,"kind": Database["public"]['Enums']["gift_card_kind"],"note": string | null,"physical": boolean,"recipient_email": string | null,"recipient_name": string | null,"sale_id": string | null,"status": Database["public"]['Enums']["gift_card_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "balance_cents": number,"business_id": string,"client_id"?: string | null,"code": string,"created_at"?: string,"created_by"?: string | null,"expires_at"?: string | null,"id"?: string,"imported"?: boolean,"initial_cents": number,"kind": Database["public"]['Enums']["gift_card_kind"],"note"?: string | null,"physical"?: boolean,"recipient_email"?: string | null,"recipient_name"?: string | null,"sale_id"?: string | null,"status"?: Database["public"]['Enums']["gift_card_status"]
                  }
                  Update: {
                    "balance_cents"?: number,"business_id"?: string,"client_id"?: string | null,"code"?: string,"created_at"?: string,"created_by"?: string | null,"expires_at"?: string | null,"id"?: string,"imported"?: boolean,"initial_cents"?: number,"kind"?: Database["public"]['Enums']["gift_card_kind"],"note"?: string | null,"physical"?: boolean,"recipient_email"?: string | null,"recipient_name"?: string | null,"sale_id"?: string | null,"status"?: Database["public"]['Enums']["gift_card_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "gift_cards_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gift_cards_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gift_cards_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "gift_cards_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"import_external_ids": {
                  Row: {
                    "business_id": string,"entity": string,"external_id": string,"imported_at": string,"internal_id": string,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"entity": string,"external_id": string,"imported_at"?: string,"internal_id": string,"source": string
                  }
                  Update: {
                    "business_id"?: string,"entity"?: string,"external_id"?: string,"imported_at"?: string,"internal_id"?: string,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_external_ids_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"insights": {
                  Row: {
                    "business_id": string,"computed_at": string,"data": NonNullable<Json>,"key": string,"kind": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"computed_at"?: string,"data": NonNullable<Json>,"key": string,"kind": string
                  }
                  Update: {
                    "business_id"?: string,"computed_at"?: string,"data"?: NonNullable<Json>,"key"?: string,"kind"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "insights_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"location_hours": {
                  Row: {
                    "business_id": string,"end_minute": number,"id": string,"location_id": string,"start_minute": number,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"end_minute": number,"id"?: string,"location_id": string,"start_minute": number,"weekday": number
                  }
                  Update: {
                    "business_id"?: string,"end_minute"?: number,"id"?: string,"location_id"?: string,"start_minute"?: number,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "location_hours_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"locations": {
                  Row: {
                    "address_line1": string | null,"address_line2": string | null,"business_id": string,"calendar_version": number,"city": string | null,"country": string,"created_at": string,"id": string,"name": string,"phone": string | null,"postal_code": string | null,"region": string | null,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address_line1"?: string | null,"address_line2"?: string | null,"business_id": string,"calendar_version"?: number,"city"?: string | null,"country"?: string,"created_at"?: string,"id"?: string,"name": string,"phone"?: string | null,"postal_code"?: string | null,"region"?: string | null,"timezone": string,"updated_at"?: string
                  }
                  Update: {
                    "address_line1"?: string | null,"address_line2"?: string | null,"business_id"?: string,"calendar_version"?: number,"city"?: string | null,"country"?: string,"created_at"?: string,"id"?: string,"name"?: string,"phone"?: string | null,"postal_code"?: string | null,"region"?: string | null,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "locations_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"marketing_automations": {
                  Row: {
                    "body": string,"business_id": string,"enabled": boolean,"kind": string,"settings": NonNullable<Json>,"subject": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"business_id": string,"enabled"?: boolean,"kind": string,"settings"?: NonNullable<Json>,"subject": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "body"?: string,"business_id"?: string,"enabled"?: boolean,"kind"?: string,"settings"?: NonNullable<Json>,"subject"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "marketing_automations_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "marketing_automations_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"marketing_messages": {
                  Row: {
                    "appointment_id": string | null,"body": string,"business_id": string,"channel": string,"client_id": string,"cycle_key": string,"id": string,"kind": string,"opt_out_token_hash": string,"opted_out_at": string | null,"outbox_message_id": string | null,"sent_at": string,"subject": string | null,"to_address": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"body": string,"business_id": string,"channel": string,"client_id": string,"cycle_key": string,"id"?: string,"kind": string,"opt_out_token_hash": string,"opted_out_at"?: string | null,"outbox_message_id"?: string | null,"sent_at"?: string,"subject"?: string | null,"to_address": string
                  }
                  Update: {
                    "appointment_id"?: string | null,"body"?: string,"business_id"?: string,"channel"?: string,"client_id"?: string,"cycle_key"?: string,"id"?: string,"kind"?: string,"opt_out_token_hash"?: string,"opted_out_at"?: string | null,"outbox_message_id"?: string | null,"sent_at"?: string,"subject"?: string | null,"to_address"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "marketing_messages_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "marketing_messages_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "marketing_messages_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "marketing_messages_outbox_message_id_fkey"
      columns: ["outbox_message_id"]
isOneToOne: false
      referencedRelation: "outbox_messages"
      referencedColumns: ["id"]
    }
                  ]
                },"membership_charges": {
                  Row: {
                    "amount_cents": number,"attempt": number,"business_id": string,"created_at": string,"failure_reason": string | null,"id": string,"membership_id": string,"period_start": string,"provider": string,"provider_reference": string | null,"sale_id": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"attempt"?: number,"business_id": string,"created_at"?: string,"failure_reason"?: string | null,"id"?: string,"membership_id": string,"period_start": string,"provider": string,"provider_reference"?: string | null,"sale_id"?: string | null,"status": string
                  }
                  Update: {
                    "amount_cents"?: number,"attempt"?: number,"business_id"?: string,"created_at"?: string,"failure_reason"?: string | null,"id"?: string,"membership_id"?: string,"period_start"?: string,"provider"?: string,"provider_reference"?: string | null,"sale_id"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "membership_charges_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_charges_membership_id_fkey"
      columns: ["membership_id"]
isOneToOne: false
      referencedRelation: "client_memberships"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_charges_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"membership_credits": {
                  Row: {
                    "allowance": number,"business_id": string,"id": string,"membership_id": string,"period_start": string,"service_id": string,"used": number
                  }
                  ComputedFields: never
                  Insert: {
                    "allowance": number,"business_id": string,"id"?: string,"membership_id": string,"period_start": string,"service_id": string,"used"?: number
                  }
                  Update: {
                    "allowance"?: number,"business_id"?: string,"id"?: string,"membership_id"?: string,"period_start"?: string,"service_id"?: string,"used"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "membership_credits_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_credits_membership_id_fkey"
      columns: ["membership_id"]
isOneToOne: false
      referencedRelation: "client_memberships"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_credits_service_id_fkey"
      columns: ["service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id"]
    }
                  ]
                },"membership_events": {
                  Row: {
                    "business_id": string,"created_at": string,"detail": string | null,"id": string,"kind": string,"membership_id": string,"sale_id": string | null,"service_id": string | null,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"detail"?: string | null,"id"?: string,"kind": string,"membership_id": string,"sale_id"?: string | null,"service_id"?: string | null,"staff_id"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"detail"?: string | null,"id"?: string,"kind"?: string,"membership_id"?: string,"sale_id"?: string | null,"service_id"?: string | null,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "membership_events_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_events_membership_id_fkey"
      columns: ["membership_id"]
isOneToOne: false
      referencedRelation: "client_memberships"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_events_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_events_service_id_fkey"
      columns: ["service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_events_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"membership_plan_services": {
                  Row: {
                    "business_id": string,"id": string,"plan_id": string,"quantity": number,"rollover": boolean,"service_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"id"?: string,"plan_id": string,"quantity": number,"rollover"?: boolean,"service_id": string
                  }
                  Update: {
                    "business_id"?: string,"id"?: string,"plan_id"?: string,"quantity"?: number,"rollover"?: boolean,"service_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "membership_plan_services_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_plan_services_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "membership_plans"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_plan_services_service_id_fkey"
      columns: ["service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id"]
    }
                  ]
                },"membership_plans": {
                  Row: {
                    "allow_pause": boolean,"business_id": string,"cancel_notice_days": number,"created_at": string,"description": string | null,"id": string,"interval_count": number,"interval_unit": string,"is_active": boolean,"max_pause_periods": number,"min_term_periods": number,"name": string,"price_cents": number,"retail_discount_pct": number,"service_discount_pct": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allow_pause"?: boolean,"business_id": string,"cancel_notice_days"?: number,"created_at"?: string,"description"?: string | null,"id"?: string,"interval_count"?: number,"interval_unit"?: string,"is_active"?: boolean,"max_pause_periods"?: number,"min_term_periods"?: number,"name": string,"price_cents": number,"retail_discount_pct"?: number,"service_discount_pct"?: number,"updated_at"?: string
                  }
                  Update: {
                    "allow_pause"?: boolean,"business_id"?: string,"cancel_notice_days"?: number,"created_at"?: string,"description"?: string | null,"id"?: string,"interval_count"?: number,"interval_unit"?: string,"is_active"?: boolean,"max_pause_periods"?: number,"min_term_periods"?: number,"name"?: string,"price_cents"?: number,"retail_discount_pct"?: number,"service_discount_pct"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "membership_plans_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "ai_action_id": string | null,"appointment_id": string | null,"body": string,"business_id": string,"channel": string,"client_id": string | null,"created_at": string,"id": string,"location_id": string,"staff_id": string | null,"status": Database["public"]['Enums']["notification_status"],"template": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_action_id"?: string | null,"appointment_id"?: string | null,"body": string,"business_id": string,"channel"?: string,"client_id"?: string | null,"created_at"?: string,"id"?: string,"location_id": string,"staff_id"?: string | null,"status"?: Database["public"]['Enums']["notification_status"],"template": string,"updated_at"?: string
                  }
                  Update: {
                    "ai_action_id"?: string | null,"appointment_id"?: string | null,"body"?: string,"business_id"?: string,"channel"?: string,"client_id"?: string | null,"created_at"?: string,"id"?: string,"location_id"?: string,"staff_id"?: string | null,"status"?: Database["public"]['Enums']["notification_status"],"template"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_ai_action_id_fkey"
      columns: ["ai_action_id"]
isOneToOne: false
      referencedRelation: "ai_actions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_appointment_id_business_id_location_id_fkey"
      columns: ["appointment_id","business_id","location_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id","business_id","location_id"]
    },{
      foreignKeyName: "notifications_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "notifications_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "notifications_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"online_booking_log": {
                  Row: {
                    "action": string,"appointment_id": string | null,"business_id": string,"client_id": string | null,"created_at": string,"id": string,"ip_hash": string | null,"source": string | null,"user_agent": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"appointment_id"?: string | null,"business_id": string,"client_id"?: string | null,"created_at"?: string,"id"?: string,"ip_hash"?: string | null,"source"?: string | null,"user_agent"?: string | null
                  }
                  Update: {
                    "action"?: string,"appointment_id"?: string | null,"business_id"?: string,"client_id"?: string | null,"created_at"?: string,"id"?: string,"ip_hash"?: string | null,"source"?: string | null,"user_agent"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "online_booking_log_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "online_booking_log_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "online_booking_log_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    }
                  ]
                },"online_booking_settings": {
                  Row: {
                    "accent_color": string | null,"allow_new_clients": boolean,"business_id": string,"cancel_cutoff_hours": number,"cancellation_policy": string,"consultation_service_id": string | null,"enabled": boolean,"notice_minutes": number,"updated_at": string,"welcome": string | null,"window_days": number
                  }
                  ComputedFields: never
                  Insert: {
                    "accent_color"?: string | null,"allow_new_clients"?: boolean,"business_id": string,"cancel_cutoff_hours"?: number,"cancellation_policy"?: string,"consultation_service_id"?: string | null,"enabled"?: boolean,"notice_minutes"?: number,"updated_at"?: string,"welcome"?: string | null,"window_days"?: number
                  }
                  Update: {
                    "accent_color"?: string | null,"allow_new_clients"?: boolean,"business_id"?: string,"cancel_cutoff_hours"?: number,"cancellation_policy"?: string,"consultation_service_id"?: string | null,"enabled"?: boolean,"notice_minutes"?: number,"updated_at"?: string,"welcome"?: string | null,"window_days"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "online_booking_settings_business_id_fkey"
      columns: ["business_id"]
isOneToOne: true
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "online_booking_settings_consultation_service_id_business_i_fkey"
      columns: ["consultation_service_id","business_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"online_verifications": {
                  Row: {
                    "attempts": number,"business_id": string,"channel": string,"code_hash": string,"created_at": string,"destination": string,"expires_at": string,"id": string,"session_hash": string | null,"verified_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"business_id": string,"channel": string,"code_hash": string,"created_at"?: string,"destination": string,"expires_at": string,"id"?: string,"session_hash"?: string | null,"verified_at"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"business_id"?: string,"channel"?: string,"code_hash"?: string,"created_at"?: string,"destination"?: string,"expires_at"?: string,"id"?: string,"session_hash"?: string | null,"verified_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "online_verifications_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"outbox_messages": {
                  Row: {
                    "body": string,"business_id": string | null,"channel": string,"created_at": string,"html": string | null,"id": string,"subject": string | null,"to_address": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"business_id"?: string | null,"channel": string,"created_at"?: string,"html"?: string | null,"id"?: string,"subject"?: string | null,"to_address": string
                  }
                  Update: {
                    "body"?: string,"business_id"?: string | null,"channel"?: string,"created_at"?: string,"html"?: string | null,"id"?: string,"subject"?: string | null,"to_address"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "outbox_messages_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"package_events": {
                  Row: {
                    "amount_cents": number | null,"appointment_item_id": string | null,"business_id": string,"client_package_id": string,"created_at": string,"id": string,"kind": string,"quantity": number | null,"reason": string | null,"sale_id": string | null,"service_id": string | null,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: number | null,"appointment_item_id"?: string | null,"business_id": string,"client_package_id": string,"created_at"?: string,"id"?: string,"kind": string,"quantity"?: number | null,"reason"?: string | null,"sale_id"?: string | null,"service_id"?: string | null,"staff_id"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number | null,"appointment_item_id"?: string | null,"business_id"?: string,"client_package_id"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"quantity"?: number | null,"reason"?: string | null,"sale_id"?: string | null,"service_id"?: string | null,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "package_events_appointment_item_id_fkey"
      columns: ["appointment_item_id"]
isOneToOne: false
      referencedRelation: "appointment_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "package_events_client_package_id_business_id_fkey"
      columns: ["client_package_id","business_id"]
isOneToOne: false
      referencedRelation: "client_packages"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "package_events_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "package_events_service_id_fkey"
      columns: ["service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "package_events_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"package_template_items": {
                  Row: {
                    "business_id": string,"quantity": number,"service_id": string,"template_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"quantity": number,"service_id": string,"template_id": string
                  }
                  Update: {
                    "business_id"?: string,"quantity"?: number,"service_id"?: string,"template_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "package_template_items_service_id_business_id_fkey"
      columns: ["service_id","business_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "package_template_items_template_id_business_id_fkey"
      columns: ["template_id","business_id"]
isOneToOne: false
      referencedRelation: "package_templates"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"package_templates": {
                  Row: {
                    "business_id": string,"created_at": string,"expiry_months": number | null,"id": string,"is_active": boolean,"levels": (Database["public"]['Enums']["staff_level"])[] | null,"name": string,"price_cents": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"expiry_months"?: number | null,"id"?: string,"is_active"?: boolean,"levels"?: (Database["public"]['Enums']["staff_level"])[] | null,"name": string,"price_cents": number,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"expiry_months"?: number | null,"id"?: string,"is_active"?: boolean,"levels"?: (Database["public"]['Enums']["staff_level"])[] | null,"name"?: string,"price_cents"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "package_templates_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_links": {
                  Row: {
                    "amount_cents": number,"business_id": string,"canceled_at": string | null,"channel": string,"client_id": string | null,"created_at": string,"created_by": string,"draft_id": string,"expires_at": string,"id": string,"location_id": string,"paid_at": string | null,"provider": string | null,"provider_reference": string | null,"sale_id": string | null,"sent_to": string,"snapshot": NonNullable<Json>,"status": string,"tip_cents": number | null,"token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"business_id": string,"canceled_at"?: string | null,"channel": string,"client_id"?: string | null,"created_at"?: string,"created_by": string,"draft_id": string,"expires_at": string,"id"?: string,"location_id": string,"paid_at"?: string | null,"provider"?: string | null,"provider_reference"?: string | null,"sale_id"?: string | null,"sent_to": string,"snapshot": NonNullable<Json>,"status"?: string,"tip_cents"?: number | null,"token_hash": string
                  }
                  Update: {
                    "amount_cents"?: number,"business_id"?: string,"canceled_at"?: string | null,"channel"?: string,"client_id"?: string | null,"created_at"?: string,"created_by"?: string,"draft_id"?: string,"expires_at"?: string,"id"?: string,"location_id"?: string,"paid_at"?: string | null,"provider"?: string | null,"provider_reference"?: string | null,"sale_id"?: string | null,"sent_to"?: string,"snapshot"?: NonNullable<Json>,"status"?: string,"tip_cents"?: number | null,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_links_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_links_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_links_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_links_draft_id_fkey"
      columns: ["draft_id"]
isOneToOne: false
      referencedRelation: "sale_drafts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_links_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_links_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_cents": number,"business_id": string,"change_cents": number | null,"created_at": string,"created_by": string | null,"gift_card_id": string | null,"id": string,"location_id": string,"method": Database["public"]['Enums']["payment_method"],"package_item_id": string | null,"processor": string | null,"processor_reference": string | null,"reason": string | null,"reference": string | null,"sale_id": string,"tendered_cents": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"business_id": string,"change_cents"?: number | null,"created_at"?: string,"created_by"?: string | null,"gift_card_id"?: string | null,"id"?: string,"location_id": string,"method": Database["public"]['Enums']["payment_method"],"package_item_id"?: string | null,"processor"?: string | null,"processor_reference"?: string | null,"reason"?: string | null,"reference"?: string | null,"sale_id": string,"tendered_cents"?: number | null
                  }
                  Update: {
                    "amount_cents"?: number,"business_id"?: string,"change_cents"?: number | null,"created_at"?: string,"created_by"?: string | null,"gift_card_id"?: string | null,"id"?: string,"location_id"?: string,"method"?: Database["public"]['Enums']["payment_method"],"package_item_id"?: string | null,"processor"?: string | null,"processor_reference"?: string | null,"reason"?: string | null,"reference"?: string | null,"sale_id"?: string,"tendered_cents"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "payments_gift_card_id_fkey"
      columns: ["gift_card_id"]
isOneToOne: false
      referencedRelation: "gift_cards"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_package_item_id_fkey"
      columns: ["package_item_id"]
isOneToOne: false
      referencedRelation: "client_package_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_sale_id_business_id_fkey"
      columns: ["sale_id","business_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"products": {
                  Row: {
                    "barcode": string | null,"brand": string,"business_id": string,"cost_cents": number,"created_at": string,"id": string,"is_active": boolean,"line": string | null,"name": string,"price_cents": number | null,"shelf": string | null,"size": number,"sku": string | null,"supplier_id": string | null,"type": Database["public"]['Enums']["product_type"],"unit": Database["public"]['Enums']["product_unit"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "barcode"?: string | null,"brand": string,"business_id": string,"cost_cents"?: number,"created_at"?: string,"id"?: string,"is_active"?: boolean,"line"?: string | null,"name": string,"price_cents"?: number | null,"shelf"?: string | null,"size": number,"sku"?: string | null,"supplier_id"?: string | null,"type": Database["public"]['Enums']["product_type"],"unit": Database["public"]['Enums']["product_unit"],"updated_at"?: string
                  }
                  Update: {
                    "barcode"?: string | null,"brand"?: string,"business_id"?: string,"cost_cents"?: number,"created_at"?: string,"id"?: string,"is_active"?: boolean,"line"?: string | null,"name"?: string,"price_cents"?: number | null,"shelf"?: string | null,"size"?: number,"sku"?: string | null,"supplier_id"?: string | null,"type"?: Database["public"]['Enums']["product_type"],"unit"?: Database["public"]['Enums']["product_unit"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_supplier_id_business_id_fkey"
      columns: ["supplier_id","business_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"purchase_order_lines": {
                  Row: {
                    "business_id": string,"id": string,"product_id": string,"purchase_order_id": string,"quantity": number,"reason": string | null,"received_quantity": number,"unit_cost_cents": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"id"?: string,"product_id": string,"purchase_order_id": string,"quantity": number,"reason"?: string | null,"received_quantity"?: number,"unit_cost_cents": number
                  }
                  Update: {
                    "business_id"?: string,"id"?: string,"product_id"?: string,"purchase_order_id"?: string,"quantity"?: number,"reason"?: string | null,"received_quantity"?: number,"unit_cost_cents"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "purchase_order_lines_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchase_order_lines_product_id_business_id_fkey"
      columns: ["product_id","business_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "purchase_order_lines_purchase_order_id_business_id_fkey"
      columns: ["purchase_order_id","business_id"]
isOneToOne: false
      referencedRelation: "purchase_orders"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"purchase_orders": {
                  Row: {
                    "ai_action_id": string | null,"business_id": string,"created_at": string,"created_by": string | null,"id": string,"location_id": string,"notes": string | null,"number": number,"received_at": string | null,"sent_at": string | null,"sent_by": string | null,"status": Database["public"]['Enums']["purchase_order_status"],"supplier_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_action_id"?: string | null,"business_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"location_id": string,"notes"?: string | null,"number"?: never,"received_at"?: string | null,"sent_at"?: string | null,"sent_by"?: string | null,"status"?: Database["public"]['Enums']["purchase_order_status"],"supplier_id": string,"updated_at"?: string
                  }
                  Update: {
                    "ai_action_id"?: string | null,"business_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"location_id"?: string,"notes"?: string | null,"number"?: never,"received_at"?: string | null,"sent_at"?: string | null,"sent_by"?: string | null,"status"?: Database["public"]['Enums']["purchase_order_status"],"supplier_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "purchase_orders_ai_action_id_fkey"
      columns: ["ai_action_id"]
isOneToOne: false
      referencedRelation: "ai_actions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchase_orders_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchase_orders_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "purchase_orders_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "purchase_orders_sent_by_business_id_fkey"
      columns: ["sent_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "purchase_orders_supplier_id_business_id_fkey"
      columns: ["supplier_id","business_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"rate_limits": {
                  Row: {
                    "hits": number,"key": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "hits"?: number,"key": string,"window_start": string
                  }
                  Update: {
                    "hits"?: number,"key"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"resources": {
                  Row: {
                    "business_id": string,"created_at": string,"id": string,"is_active": boolean,"kind": Database["public"]['Enums']["resource_kind"],"location_id": string,"name": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"kind": Database["public"]['Enums']["resource_kind"],"location_id": string,"name": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"kind"?: Database["public"]['Enums']["resource_kind"],"location_id"?: string,"name"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "resources_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "resources_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"sale_drafts": {
                  Row: {
                    "appointment_id": string | null,"business_id": string,"client_id": string | null,"created_at": string,"created_by": string | null,"id": string,"location_id": string,"return_to": string | null,"sale_id": string | null,"status": string,"ticket": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"business_id": string,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"location_id": string,"return_to"?: string | null,"sale_id"?: string | null,"status"?: string,"ticket"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "appointment_id"?: string | null,"business_id"?: string,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"location_id"?: string,"return_to"?: string | null,"sale_id"?: string | null,"status"?: string,"ticket"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_drafts_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_drafts_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_drafts_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_drafts_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "sale_drafts_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "sale_drafts_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"sale_events": {
                  Row: {
                    "amount_cents": number | null,"business_id": string,"created_at": string,"detail": string | null,"id": string,"kind": string,"sale_id": string,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: number | null,"business_id": string,"created_at"?: string,"detail"?: string | null,"id"?: string,"kind": string,"sale_id": string,"staff_id"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number | null,"business_id"?: string,"created_at"?: string,"detail"?: string | null,"id"?: string,"kind"?: string,"sale_id"?: string,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_events_sale_id_business_id_fkey"
      columns: ["sale_id","business_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "sale_events_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"sale_items": {
                  Row: {
                    "appointment_item_id": string | null,"booked_price_cents": number | null,"business_id": string,"client_package_id": string | null,"commission_pct": number | null,"description": string,"discount_cents": number,"gift_card_id": string | null,"id": string,"kind": Database["public"]['Enums']["sale_item_kind"],"line_discount_cents": number,"line_discount_reason": string | null,"member_discount_cents": number,"membership_credit_id": string | null,"membership_id": string | null,"package_item_id": string | null,"position": number,"price_reason": string | null,"product_id": string | null,"quantity": number,"returned_quantity": number,"sale_id": string,"service_id": string | null,"staff_id": string | null,"tax_cents": number,"total_cents": number,"unit_price_cents": number
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_item_id"?: string | null,"booked_price_cents"?: number | null,"business_id": string,"client_package_id"?: string | null,"commission_pct"?: number | null,"description": string,"discount_cents"?: number,"gift_card_id"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["sale_item_kind"],"line_discount_cents"?: number,"line_discount_reason"?: string | null,"member_discount_cents"?: number,"membership_credit_id"?: string | null,"membership_id"?: string | null,"package_item_id"?: string | null,"position": number,"price_reason"?: string | null,"product_id"?: string | null,"quantity"?: number,"returned_quantity"?: number,"sale_id": string,"service_id"?: string | null,"staff_id"?: string | null,"tax_cents"?: number,"total_cents": number,"unit_price_cents": number
                  }
                  Update: {
                    "appointment_item_id"?: string | null,"booked_price_cents"?: number | null,"business_id"?: string,"client_package_id"?: string | null,"commission_pct"?: number | null,"description"?: string,"discount_cents"?: number,"gift_card_id"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["sale_item_kind"],"line_discount_cents"?: number,"line_discount_reason"?: string | null,"member_discount_cents"?: number,"membership_credit_id"?: string | null,"membership_id"?: string | null,"package_item_id"?: string | null,"position"?: number,"price_reason"?: string | null,"product_id"?: string | null,"quantity"?: number,"returned_quantity"?: number,"sale_id"?: string,"service_id"?: string | null,"staff_id"?: string | null,"tax_cents"?: number,"total_cents"?: number,"unit_price_cents"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_items_appointment_item_id_fkey"
      columns: ["appointment_item_id"]
isOneToOne: false
      referencedRelation: "appointment_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_client_package_id_fkey"
      columns: ["client_package_id"]
isOneToOne: false
      referencedRelation: "client_packages"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_gift_card_id_fkey"
      columns: ["gift_card_id"]
isOneToOne: false
      referencedRelation: "gift_cards"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_membership_credit_id_fkey"
      columns: ["membership_credit_id"]
isOneToOne: false
      referencedRelation: "membership_credits"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_membership_id_fkey"
      columns: ["membership_id"]
isOneToOne: false
      referencedRelation: "client_memberships"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_package_item_id_fkey"
      columns: ["package_item_id"]
isOneToOne: false
      referencedRelation: "client_package_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_sale_id_business_id_fkey"
      columns: ["sale_id","business_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "sale_items_service_id_fkey"
      columns: ["service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"sale_tips": {
                  Row: {
                    "amount_cents": number,"business_id": string,"sale_id": string,"staff_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"business_id": string,"sale_id": string,"staff_id": string
                  }
                  Update: {
                    "amount_cents"?: number,"business_id"?: string,"sale_id"?: string,"staff_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_tips_sale_id_business_id_fkey"
      columns: ["sale_id","business_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "sale_tips_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"sales": {
                  Row: {
                    "appointment_id": string | null,"business_id": string,"client_id": string | null,"created_at": string,"created_by": string | null,"discount_cents": number,"discount_reason": string | null,"draft_id": string | null,"id": string,"location_id": string,"note": string | null,"number": number,"rebook_appointment_id": string | null,"receipt_email": string | null,"refunded_cents": number,"status": Database["public"]['Enums']["sale_status"],"subtotal_cents": number,"tax_cents": number,"tip_cents": number,"total_cents": number,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"business_id": string,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"discount_cents"?: number,"discount_reason"?: string | null,"draft_id"?: string | null,"id"?: string,"location_id": string,"note"?: string | null,"number": number,"rebook_appointment_id"?: string | null,"receipt_email"?: string | null,"refunded_cents"?: number,"status"?: Database["public"]['Enums']["sale_status"],"subtotal_cents": number,"tax_cents"?: number,"tip_cents"?: number,"total_cents": number,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "appointment_id"?: string | null,"business_id"?: string,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"discount_cents"?: number,"discount_reason"?: string | null,"draft_id"?: string | null,"id"?: string,"location_id"?: string,"note"?: string | null,"number"?: number,"rebook_appointment_id"?: string | null,"receipt_email"?: string | null,"refunded_cents"?: number,"status"?: Database["public"]['Enums']["sale_status"],"subtotal_cents"?: number,"tax_cents"?: number,"tip_cents"?: number,"total_cents"?: number,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sales_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "sales_draft_id_fkey"
      columns: ["draft_id"]
isOneToOne: false
      referencedRelation: "sale_drafts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "sales_rebook_appointment_id_fkey"
      columns: ["rebook_appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_voided_by_business_id_fkey"
      columns: ["voided_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"schedule_disruptions": {
                  Row: {
                    "appointment_id": string | null,"business_id": string,"created_at": string,"id": string,"item_id": string | null,"kind": Database["public"]['Enums']["disruption_kind"],"location_id": string,"minutes": number | null,"on_date": string,"reported_by": string | null,"resolved_by_action": string | null,"staff_id": string | null,"starts_at": string | null,"time_off_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"business_id": string,"created_at"?: string,"id"?: string,"item_id"?: string | null,"kind": Database["public"]['Enums']["disruption_kind"],"location_id": string,"minutes"?: number | null,"on_date": string,"reported_by"?: string | null,"resolved_by_action"?: string | null,"staff_id"?: string | null,"starts_at"?: string | null,"time_off_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "appointment_id"?: string | null,"business_id"?: string,"created_at"?: string,"id"?: string,"item_id"?: string | null,"kind"?: Database["public"]['Enums']["disruption_kind"],"location_id"?: string,"minutes"?: number | null,"on_date"?: string,"reported_by"?: string | null,"resolved_by_action"?: string | null,"staff_id"?: string | null,"starts_at"?: string | null,"time_off_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "schedule_disruptions_appointment_id_business_id_location_i_fkey"
      columns: ["appointment_id","business_id","location_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id","business_id","location_id"]
    },{
      foreignKeyName: "schedule_disruptions_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_disruptions_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "appointment_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_disruptions_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "schedule_disruptions_reported_by_business_id_fkey"
      columns: ["reported_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "schedule_disruptions_resolved_by_action_fkey"
      columns: ["resolved_by_action"]
isOneToOne: false
      referencedRelation: "ai_actions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_disruptions_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "schedule_disruptions_time_off_id_fkey"
      columns: ["time_off_id"]
isOneToOne: false
      referencedRelation: "staff_time_off"
      referencedColumns: ["id"]
    }
                  ]
                },"service_level_prices": {
                  Row: {
                    "business_id": string,"level": Database["public"]['Enums']["staff_level"],"price_cents": number,"service_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"level": Database["public"]['Enums']["staff_level"],"price_cents": number,"service_id": string
                  }
                  Update: {
                    "business_id"?: string,"level"?: Database["public"]['Enums']["staff_level"],"price_cents"?: number,"service_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_level_prices_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_level_prices_service_id_business_id_fkey"
      columns: ["service_id","business_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"service_products": {
                  Row: {
                    "amount": number,"business_id": string,"id": string,"product_id": string,"service_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"business_id": string,"id"?: string,"product_id": string,"service_id": string
                  }
                  Update: {
                    "amount"?: number,"business_id"?: string,"id"?: string,"product_id"?: string,"service_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_products_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_products_product_id_business_id_fkey"
      columns: ["product_id","business_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "service_products_service_id_business_id_fkey"
      columns: ["service_id","business_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"services": {
                  Row: {
                    "active_minutes": number,"archived_at": string | null,"business_id": string,"category": string,"created_at": string,"deposit_amount": number,"deposit_kind": Database["public"]['Enums']["deposit_kind"],"description": string | null,"duration_minutes": number | null,"finishing_minutes": number,"id": string,"name": string,"online_booking": Database["public"]['Enums']["online_service_mode"],"price_cents": number,"processing_minutes": number,"requires_patch_test": boolean,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active_minutes": number,"archived_at"?: string | null,"business_id": string,"category": string,"created_at"?: string,"deposit_amount"?: number,"deposit_kind"?: Database["public"]['Enums']["deposit_kind"],"description"?: string | null,"duration_minutes"?: never,"finishing_minutes"?: number,"id"?: string,"name": string,"online_booking"?: Database["public"]['Enums']["online_service_mode"],"price_cents": number,"processing_minutes"?: number,"requires_patch_test"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "active_minutes"?: number,"archived_at"?: string | null,"business_id"?: string,"category"?: string,"created_at"?: string,"deposit_amount"?: number,"deposit_kind"?: Database["public"]['Enums']["deposit_kind"],"description"?: string | null,"duration_minutes"?: never,"finishing_minutes"?: number,"id"?: string,"name"?: string,"online_booking"?: Database["public"]['Enums']["online_service_mode"],"price_cents"?: number,"processing_minutes"?: number,"requires_patch_test"?: boolean,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "services_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"staff": {
                  Row: {
                    "business_id": string,"calendar_zoom": string,"color": string | null,"created_at": string,"email": string | null,"first_name": string,"id": string,"is_active": boolean,"last_name": string,"level": Database["public"]['Enums']["staff_level"] | null,"location_id": string,"phone": string | null,"photo_path": string | null,"role": Database["public"]['Enums']["staff_role"],"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"calendar_zoom"?: string,"color"?: string | null,"created_at"?: string,"email"?: string | null,"first_name": string,"id"?: string,"is_active"?: boolean,"last_name"?: string,"level"?: Database["public"]['Enums']["staff_level"] | null,"location_id": string,"phone"?: string | null,"photo_path"?: string | null,"role"?: Database["public"]['Enums']["staff_role"],"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"calendar_zoom"?: string,"color"?: string | null,"created_at"?: string,"email"?: string | null,"first_name"?: string,"id"?: string,"is_active"?: boolean,"last_name"?: string,"level"?: Database["public"]['Enums']["staff_level"] | null,"location_id"?: string,"phone"?: string | null,"photo_path"?: string | null,"role"?: Database["public"]['Enums']["staff_role"],"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"staff_compensation": {
                  Row: {
                    "business_id": string,"hourly_rate_cents": number | null,"retail_commission_pct": number,"service_commission_pct": number,"staff_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"hourly_rate_cents"?: number | null,"retail_commission_pct"?: number,"service_commission_pct"?: number,"staff_id": string,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"hourly_rate_cents"?: number | null,"retail_commission_pct"?: number,"service_commission_pct"?: number,"staff_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_compensation_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"staff_compensation_history": {
                  Row: {
                    "business_id": string,"changed_by": string | null,"created_at": string,"effective_from": string,"hourly_rate_cents": number | null,"id": string,"retail_commission_pct": number,"service_commission_pct": number,"staff_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"changed_by"?: string | null,"created_at"?: string,"effective_from": string,"hourly_rate_cents"?: number | null,"id"?: string,"retail_commission_pct": number,"service_commission_pct": number,"staff_id": string
                  }
                  Update: {
                    "business_id"?: string,"changed_by"?: string | null,"created_at"?: string,"effective_from"?: string,"hourly_rate_cents"?: number | null,"id"?: string,"retail_commission_pct"?: number,"service_commission_pct"?: number,"staff_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_compensation_history_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_compensation_history_changed_by_fkey"
      columns: ["changed_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_compensation_history_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_schedule_overrides": {
                  Row: {
                    "business_id": string,"created_at": string,"end_minute": number,"id": string,"on_date": string,"staff_id": string,"start_minute": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"end_minute": number,"id"?: string,"on_date": string,"staff_id": string,"start_minute": number
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"end_minute"?: number,"id"?: string,"on_date"?: string,"staff_id"?: string,"start_minute"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_schedule_overrides_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"staff_services": {
                  Row: {
                    "active_minutes": number | null,"business_id": string,"created_at": string,"finishing_minutes": number | null,"price_cents": number | null,"processing_minutes": number | null,"service_id": string,"staff_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active_minutes"?: number | null,"business_id": string,"created_at"?: string,"finishing_minutes"?: number | null,"price_cents"?: number | null,"processing_minutes"?: number | null,"service_id": string,"staff_id": string,"updated_at"?: string
                  }
                  Update: {
                    "active_minutes"?: number | null,"business_id"?: string,"created_at"?: string,"finishing_minutes"?: number | null,"price_cents"?: number | null,"processing_minutes"?: number | null,"service_id"?: string,"staff_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_services_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_services_service_id_business_id_fkey"
      columns: ["service_id","business_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "staff_services_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"staff_time_off": {
                  Row: {
                    "business_id": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"end_minute": number | null,"ends_on": string,"id": string,"note": string | null,"reason": Database["public"]['Enums']["time_off_reason"],"requested_by": string,"staff_id": string,"start_minute": number | null,"starts_on": string,"status": Database["public"]['Enums']["time_off_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"end_minute"?: number | null,"ends_on": string,"id"?: string,"note"?: string | null,"reason": Database["public"]['Enums']["time_off_reason"],"requested_by": string,"staff_id": string,"start_minute"?: number | null,"starts_on": string,"status"?: Database["public"]['Enums']["time_off_status"],"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"end_minute"?: number | null,"ends_on"?: string,"id"?: string,"note"?: string | null,"reason"?: Database["public"]['Enums']["time_off_reason"],"requested_by"?: string,"staff_id"?: string,"start_minute"?: number | null,"starts_on"?: string,"status"?: Database["public"]['Enums']["time_off_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_time_off_decided_by_business_id_fkey"
      columns: ["decided_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "staff_time_off_requested_by_business_id_fkey"
      columns: ["requested_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "staff_time_off_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"staff_working_hours": {
                  Row: {
                    "business_id": string,"end_minute": number,"id": string,"staff_id": string,"start_minute": number,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"end_minute": number,"id"?: string,"staff_id": string,"start_minute": number,"weekday": number
                  }
                  Update: {
                    "business_id"?: string,"end_minute"?: number,"id"?: string,"staff_id"?: string,"start_minute"?: number,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_working_hours_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"stock_levels": {
                  Row: {
                    "business_id": string,"id": string,"location_id": string,"on_hand": number,"product_id": string,"reorder_point": number,"reorder_quantity": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"id"?: string,"location_id": string,"on_hand"?: number,"product_id": string,"reorder_point"?: number,"reorder_quantity"?: number,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"id"?: string,"location_id"?: string,"on_hand"?: number,"product_id"?: string,"reorder_point"?: number,"reorder_quantity"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_levels_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_levels_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stock_levels_product_id_business_id_fkey"
      columns: ["product_id","business_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"stock_movements": {
                  Row: {
                    "appointment_id": string | null,"appointment_item_id": string | null,"business_id": string,"change": number,"created_at": string,"created_by": string | null,"id": string,"location_id": string,"note": string | null,"on_hand_after": number,"product_id": string,"purchase_order_id": string | null,"reason": Database["public"]['Enums']["stock_reason"],"stocktake_id": string | null,"unit_cost_cents": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"appointment_item_id"?: string | null,"business_id": string,"change": number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"location_id": string,"note"?: string | null,"on_hand_after": number,"product_id": string,"purchase_order_id"?: string | null,"reason": Database["public"]['Enums']["stock_reason"],"stocktake_id"?: string | null,"unit_cost_cents"?: number | null
                  }
                  Update: {
                    "appointment_id"?: string | null,"appointment_item_id"?: string | null,"business_id"?: string,"change"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"location_id"?: string,"note"?: string | null,"on_hand_after"?: number,"product_id"?: string,"purchase_order_id"?: string | null,"reason"?: Database["public"]['Enums']["stock_reason"],"stocktake_id"?: string | null,"unit_cost_cents"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_movements_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_appointment_item_id_fkey"
      columns: ["appointment_item_id"]
isOneToOne: false
      referencedRelation: "appointment_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stock_movements_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stock_movements_product_id_business_id_fkey"
      columns: ["product_id","business_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stock_movements_purchase_order_id_fkey"
      columns: ["purchase_order_id"]
isOneToOne: false
      referencedRelation: "purchase_orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_stocktake_id_fkey"
      columns: ["stocktake_id"]
isOneToOne: false
      referencedRelation: "stocktakes"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_overrides": {
                  Row: {
                    "approved_by": string,"business_id": string,"created_at": string,"draft_id": string,"id": string,"product_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_by": string,"business_id": string,"created_at"?: string,"draft_id": string,"id"?: string,"product_id": string
                  }
                  Update: {
                    "approved_by"?: string,"business_id"?: string,"created_at"?: string,"draft_id"?: string,"id"?: string,"product_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_overrides_approved_by_business_id_fkey"
      columns: ["approved_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stock_overrides_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_overrides_draft_id_fkey"
      columns: ["draft_id"]
isOneToOne: false
      referencedRelation: "sale_drafts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_overrides_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"stocktake_counts": {
                  Row: {
                    "business_id": string,"counted": number,"counted_at": string,"counted_by": string | null,"expected": number,"id": string,"product_id": string,"stocktake_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"counted": number,"counted_at"?: string,"counted_by"?: string | null,"expected": number,"id"?: string,"product_id": string,"stocktake_id": string
                  }
                  Update: {
                    "business_id"?: string,"counted"?: number,"counted_at"?: string,"counted_by"?: string | null,"expected"?: number,"id"?: string,"product_id"?: string,"stocktake_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stocktake_counts_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stocktake_counts_counted_by_business_id_fkey"
      columns: ["counted_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stocktake_counts_product_id_business_id_fkey"
      columns: ["product_id","business_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stocktake_counts_stocktake_id_business_id_fkey"
      columns: ["stocktake_id","business_id"]
isOneToOne: false
      referencedRelation: "stocktakes"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"stocktakes": {
                  Row: {
                    "business_id": string,"finished_at": string | null,"finished_by": string | null,"id": string,"location_id": string,"started_at": string,"started_by": string | null,"status": Database["public"]['Enums']["stocktake_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"finished_at"?: string | null,"finished_by"?: string | null,"id"?: string,"location_id": string,"started_at"?: string,"started_by"?: string | null,"status"?: Database["public"]['Enums']["stocktake_status"]
                  }
                  Update: {
                    "business_id"?: string,"finished_at"?: string | null,"finished_by"?: string | null,"id"?: string,"location_id"?: string,"started_at"?: string,"started_by"?: string | null,"status"?: Database["public"]['Enums']["stocktake_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "stocktakes_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stocktakes_finished_by_business_id_fkey"
      columns: ["finished_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stocktakes_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stocktakes_started_by_business_id_fkey"
      columns: ["started_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"suppliers": {
                  Row: {
                    "account_number": string | null,"business_id": string,"created_at": string,"email": string | null,"id": string,"is_active": boolean,"lead_time_days": number,"name": string,"notes": string | null,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_number"?: string | null,"business_id": string,"created_at"?: string,"email"?: string | null,"id"?: string,"is_active"?: boolean,"lead_time_days"?: number,"name": string,"notes"?: string | null,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_number"?: string | null,"business_id"?: string,"created_at"?: string,"email"?: string | null,"id"?: string,"is_active"?: boolean,"lead_time_days"?: number,"name"?: string,"notes"?: string | null,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "suppliers_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"time_block_skips": {
                  Row: {
                    "block_id": string,"business_id": string,"on_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "block_id": string,"business_id": string,"on_date": string
                  }
                  Update: {
                    "block_id"?: string,"business_id"?: string,"on_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "time_block_skips_block_id_business_id_fkey"
      columns: ["block_id","business_id"]
isOneToOne: false
      referencedRelation: "time_blocks"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"time_blocks": {
                  Row: {
                    "business_id": string,"created_at": string,"created_by": string | null,"end_minute": number,"ends_on": string | null,"id": string,"kind": Database["public"]['Enums']["time_block_kind"],"location_id": string,"note": string | null,"on_date": string | null,"repeat_weekdays": (number)[] | null,"staff_id": string,"start_minute": number,"starts_on": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"created_by"?: string | null,"end_minute": number,"ends_on"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["time_block_kind"],"location_id": string,"note"?: string | null,"on_date"?: string | null,"repeat_weekdays"?: (number)[] | null,"staff_id": string,"start_minute": number,"starts_on"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"created_by"?: string | null,"end_minute"?: number,"ends_on"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["time_block_kind"],"location_id"?: string,"note"?: string | null,"on_date"?: string | null,"repeat_weekdays"?: (number)[] | null,"staff_id"?: string,"start_minute"?: number,"starts_on"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "time_blocks_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "time_blocks_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "time_blocks_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "time_blocks_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"visit_photos": {
                  Row: {
                    "appointment_id": string,"business_id": string,"client_id": string,"created_at": string,"created_by": string | null,"id": string,"kind": string,"marketing_marked_at": string | null,"marketing_marked_by": string | null,"marketing_ok": boolean,"staff_id": string | null,"storage_path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id": string,"business_id": string,"client_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind": string,"marketing_marked_at"?: string | null,"marketing_marked_by"?: string | null,"marketing_ok"?: boolean,"staff_id"?: string | null,"storage_path": string
                  }
                  Update: {
                    "appointment_id"?: string,"business_id"?: string,"client_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: string,"marketing_marked_at"?: string | null,"marketing_marked_by"?: string | null,"marketing_ok"?: boolean,"staff_id"?: string | null,"storage_path"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "visit_photos_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_photos_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_photos_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_photos_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_photos_marketing_marked_by_fkey"
      columns: ["marketing_marked_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_photos_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"waitlist_entries": {
                  Row: {
                    "appointment_id": string | null,"business_id": string,"client_id": string,"created_at": string,"created_by": string | null,"from_date": string,"id": string,"location_id": string,"notes": string | null,"service_ids": (string)[],"staff_ids": (string)[],"status": Database["public"]['Enums']["waitlist_status"],"to_date": string,"updated_at": string,"windows": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"business_id": string,"client_id": string,"created_at"?: string,"created_by"?: string | null,"from_date": string,"id"?: string,"location_id": string,"notes"?: string | null,"service_ids": (string)[],"staff_ids"?: (string)[],"status"?: Database["public"]['Enums']["waitlist_status"],"to_date": string,"updated_at"?: string,"windows"?: (string)[]
                  }
                  Update: {
                    "appointment_id"?: string | null,"business_id"?: string,"client_id"?: string,"created_at"?: string,"created_by"?: string | null,"from_date"?: string,"id"?: string,"location_id"?: string,"notes"?: string | null,"service_ids"?: (string)[],"staff_ids"?: (string)[],"status"?: Database["public"]['Enums']["waitlist_status"],"to_date"?: string,"updated_at"?: string,"windows"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "waitlist_entries_appointment_id_business_id_location_id_fkey"
      columns: ["appointment_id","business_id","location_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id","business_id","location_id"]
    },{
      foreignKeyName: "waitlist_entries_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "waitlist_entries_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "waitlist_entries_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "waitlist_entries_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"walk_ins": {
                  Row: {
                    "appointment_id": string | null,"arrived_at": string,"business_id": string,"client_id": string | null,"created_by": string | null,"id": string,"location_id": string,"name": string,"phone": string | null,"service_id": string,"status": Database["public"]['Enums']["walk_in_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"arrived_at"?: string,"business_id": string,"client_id"?: string | null,"created_by"?: string | null,"id"?: string,"location_id": string,"name": string,"phone"?: string | null,"service_id": string,"status"?: Database["public"]['Enums']["walk_in_status"],"updated_at"?: string
                  }
                  Update: {
                    "appointment_id"?: string | null,"arrived_at"?: string,"business_id"?: string,"client_id"?: string | null,"created_by"?: string | null,"id"?: string,"location_id"?: string,"name"?: string,"phone"?: string | null,"service_id"?: string,"status"?: Database["public"]['Enums']["walk_in_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "walk_ins_appointment_id_business_id_location_id_fkey"
      columns: ["appointment_id","business_id","location_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id","business_id","location_id"]
    },{
      foreignKeyName: "walk_ins_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "walk_ins_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "walk_ins_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "walk_ins_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "walk_ins_service_id_business_id_fkey"
      columns: ["service_id","business_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id","business_id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "add_formula":
{ Args: { "p_appointment_item_id": string,"p_client_id": string,"p_formula": string,"p_lines": Json,"p_notes": string,"p_visit_date": string }; Returns: string
                           },
"add_visit_photo":
{ Args: { "p_appointment_id": string,"p_kind": string,"p_path": string }; Returns: string
                           },
"adjust_gift_card":
{ Args: { "p_card_id": string,"p_change_cents": number,"p_reason": string }; Returns: number
                           },
"adjust_stock":
{ Args: { "p_change": number,"p_location_id": string,"p_note": string,"p_product_id": string,"p_reason": Database["public"]['Enums']["stock_reason"] }; Returns: number
                           },
"advance_membership":
{ Args: { "p_membership_id": string,"p_today": string }; Returns: Json
                           },
"ai_usage_today":
{ Args: { "p_business_id": string }; Returns: {
              "daily_limit": number,"used": number
            }[]
                           },
"apply_ai_action":
{ Args: { "p_action_id": string,"p_client_id"?: string,"p_expected_version": number }; Returns: undefined
                           },
"apply_automation_action":
{ Args: { "p_action_id": string }; Returns: undefined
                           },
"apply_duration_action":
{ Args: { "p_action_id": string }; Returns: undefined
                           },
"apply_reorder_draft":
{ Args: { "p_action_id": string }; Returns: string
                           },
"approve_stock_override":
{ Args: { "p_draft_id": string,"p_product_id": string }; Returns: undefined
                           },
"cancel_membership":
{ Args: { "p_membership_id": string,"p_now": boolean,"p_reason": string }; Returns: string
                           },
"cancel_online_appointment":
{ Args: { "p_appointment_id": string,"p_manage_token_hash": string }; Returns: undefined
                           },
"cancel_package":
{ Args: { "p_client_package_id": string,"p_reason": string,"p_refund_method": string }; Returns: number
                           },
"cancel_payment_link":
{ Args: { "p_link_id": string }; Returns: undefined
                           },
"cancel_stocktake":
{ Args: { "p_stocktake_id": string }; Returns: undefined
                           },
"check_in_patch_override":
{ Args: { "p_appointment_id": string,"p_reason": string }; Returns: undefined
                           },
"clear_count":
{ Args: { "p_product_id": string,"p_stocktake_id": string }; Returns: undefined
                           },
"complete_payment_link":
{ Args: { "p_link_id": string,"p_provider": string,"p_reference": string,"p_tips": Json,"p_total_cents": number }; Returns: string
                           },
"complete_sale":
{ Args: { "p_input": Json,"p_location_id": string }; Returns: string
                           },
"configure_scheduled_jobs":
{ Args: { "p_app_url": string,"p_secret": string }; Returns: undefined
                           },
"create_payment_link":
{ Args: { "p_amount_cents": number,"p_channel": string,"p_draft_id": string,"p_hours": number,"p_snapshot": Json,"p_to": string,"p_token_hash": string }; Returns: string
                           },
"delete_purchase_order":
{ Args: { "p_order_id": string }; Returns: undefined
                           },
"delete_visit_photo":
{ Args: { "p_photo_id": string }; Returns: string
                           },
"dismiss_denise_item":
{ Args: { "p_day": string,"p_key": string,"p_location_id": string }; Returns: undefined
                           },
"find_online_client":
{ Args: { "p_business_id": string,"p_email": string,"p_first_name": string,"p_last_name": string,"p_phone": string,"p_phone_digits": string }; Returns: string
                           },
"finish_stocktake":
{ Args: { "p_stocktake_id": string }; Returns: number
                           },
"hit_rate_limit":
{ Args: { "p_key": string,"p_limit": number,"p_window_seconds": number }; Returns: boolean
                           },
"import_gift_card":
{ Args: { "p_balance_cents": number,"p_business_id": string,"p_client_id": string,"p_code": string,"p_expires_at": string,"p_initial_cents": number,"p_issued_at": string }; Returns: string
                           },
"issue_promo_card":
{ Args: { "p_amount_cents": number,"p_client_id": string,"p_expires_in_days": number,"p_reason": string,"p_recipient_email": string,"p_recipient_name": string }; Returns: string
                           },
"keep_membership":
{ Args: { "p_membership_id": string }; Returns: undefined
                           },
"log_data_export":
{ Args: { "p_business_id": string,"p_bytes": number,"p_row_counts": Json }; Returns: string
                           },
"log_receipt_email":
{ Args: { "p_email": string,"p_sale_id": string }; Returns: undefined
                           },
"lookup_gift_card":
{ Args: { "p_code": string }; Returns: Json
                           },
"marketing_opt_out":
{ Args: { "p_token_hash": string }; Returns: Json
                           },
"move_time_block":
{ Args: { "p_block_id": string,"p_end": number,"p_on_date": string,"p_start": number }; Returns: string
                           },
"pause_membership":
{ Args: { "p_membership_id": string,"p_periods": number }; Returns: undefined
                           },
"payroll_sales":
{ Args: { "p_business_id": string,"p_from": string,"p_staff_id"?: string,"p_to": string }; Returns: Json
                           },
"receive_purchase_order":
{ Args: { "p_lines": Json,"p_order_id": string }; Returns: Database["public"]['Enums']["purchase_order_status"]
                           },
"record_ai_proposals":
{ Args: { "p_feature": string,"p_location_id": string,"p_options": Json,"p_subject": string }; Returns: (string)[]
                           },
"record_ai_proposals_as_system":
{ Args: { "p_feature": string,"p_location_id": string,"p_options": Json,"p_subject": string }; Returns: (string)[]
                           },
"record_ai_usage":
{ Args: { "p_business_id": string,"p_cache_read": number,"p_feature": string,"p_input": number,"p_model": string,"p_output": number }; Returns: undefined
                           },
"record_count":
{ Args: { "p_counted": number,"p_product_id": string,"p_stocktake_id": string }; Returns: number
                           },
"record_item_time":
{ Args: { "p_event": string,"p_item_id": string }; Returns: undefined
                           },
"record_membership_charge":
{ Args: { "p_membership_id": string,"p_result": Json,"p_today": string }; Returns: Json
                           },
"refund_sale":
{ Args: { "p_input": Json,"p_sale_id": string }; Returns: undefined
                           },
"reject_ai_action":
{ Args: { "p_action_id": string }; Returns: undefined
                           },
"report_call_out":
{ Args: { "p_from": string,"p_staff_id": string }; Returns: string
                           },
"report_running_late":
{ Args: { "p_item_id": string,"p_minutes": number }; Returns: string
                           },
"resume_membership":
{ Args: { "p_membership_id": string }; Returns: undefined
                           },
"retry_membership_payment":
{ Args: { "p_membership_id": string }; Returns: undefined
                           },
"run_scheduled_job_now":
{ Args: { "p_path": string }; Returns: number
                           },
"save_appointment":
{ Args: { "p_appointment_id": string,"p_client_id": string,"p_expected_version": number,"p_items": Json,"p_location_id": string,"p_notes": string }; Returns: string
                           },
"save_automation":
{ Args: { "p_business_id": string,"p_input": Json,"p_kind": string }; Returns: undefined
                           },
"save_closeout":
{ Args: { "p_counted_cents": number,"p_day": string,"p_location_id": string,"p_note": string }; Returns: number
                           },
"save_membership_plan":
{ Args: { "p_business_id": string,"p_input": Json,"p_plan_id": string }; Returns: string
                           },
"save_online_appointment":
{ Args: { "p_appointment_id": string,"p_client_id": string,"p_expected_version": number,"p_items": Json,"p_location_id": string,"p_manage_token_hash": string,"p_notes": string,"p_source"?: string }; Returns: string
                           },
"save_package_template":
{ Args: { "p_input": Json,"p_template_id": string }; Returns: string
                           },
"save_purchase_order":
{ Args: { "p_lines": Json,"p_location_id": string,"p_notes": string,"p_order_id": string,"p_supplier_id": string }; Returns: string
                           },
"save_service":
{ Args: { "p_active_minutes": number,"p_business_id": string,"p_category": string,"p_description": string,"p_finishing_minutes": number,"p_name": string,"p_price_cents": number,"p_processing_minutes": number,"p_service_id": string,"p_staff": Json }; Returns: string
                           },
"scheduled_jobs_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"send_purchase_order":
{ Args: { "p_order_id": string }; Returns: undefined
                           },
"set_appointment_group":
{ Args: { "p_appointment_id": string,"p_group_id": string }; Returns: undefined
                           },
"set_appointment_notes":
{ Args: { "p_appointment_id": string,"p_notes": string }; Returns: undefined
                           },
"set_appointment_series":
{ Args: { "p_appointment_id": string,"p_index": number,"p_series_id": string }; Returns: undefined
                           },
"set_appointment_status":
{ Args: { "p_appointment_id": string,"p_reason": string,"p_status": Database["public"]['Enums']["appointment_status"] }; Returns: undefined
                           },
"set_calendar_zoom":
{ Args: { "p_zoom": string }; Returns: undefined
                           },
"set_checkout_settings":
{ Args: { "p_business_id": string,"p_settings": Json }; Returns: undefined
                           },
"set_gift_card_settings":
{ Args: { "p_business_id": string,"p_expiry_months": number,"p_presets": (number)[],"p_promo_days": number }; Returns: undefined
                           },
"set_location_hours":
{ Args: { "p_business_id": string,"p_hours": Json,"p_location_id": string }; Returns: undefined
                           },
"set_payroll_settings":
{ Args: { "p_anchor": string,"p_business_id": string,"p_pay_period": string }; Returns: undefined
                           },
"set_photo_consent":
{ Args: { "p_client_id": string,"p_on": string }; Returns: undefined
                           },
"set_photo_marketing":
{ Args: { "p_ok": boolean,"p_photo_id": string }; Returns: undefined
                           },
"set_service_level_prices":
{ Args: { "p_prices": Json,"p_service_id": string }; Returns: undefined
                           },
"set_service_recipe":
{ Args: { "p_lines": Json,"p_service_id": string }; Returns: undefined
                           },
"set_staff_day_override":
{ Args: { "p_business_id": string,"p_hours": Json,"p_on_date": string,"p_staff_id": string }; Returns: undefined
                           },
"set_staff_weekly_hours":
{ Args: { "p_business_id": string,"p_hours": Json,"p_staff_id": string }; Returns: undefined
                           },
"set_stock_settings":
{ Args: { "p_location_id": string,"p_product_id": string,"p_reorder_point": number,"p_reorder_quantity": number }; Returns: undefined
                           },
"start_stocktake":
{ Args: { "p_location_id": string }; Returns: string
                           },
"undo_ai_action":
{ Args: { "p_action_id": string,"p_expected_version": number }; Returns: undefined
                           },
"undo_automation_action":
{ Args: { "p_action_id": string }; Returns: undefined
                           },
"undo_check_in":
{ Args: { "p_appointment_id": string }; Returns: undefined
                           },
"undo_duration_action":
{ Args: { "p_action_id": string }; Returns: undefined
                           },
"undo_no_show":
{ Args: { "p_appointment_id": string,"p_expected_version": number }; Returns: undefined
                           },
"undo_reorder_draft":
{ Args: { "p_action_id": string }; Returns: undefined
                           },
"update_membership_card":
{ Args: { "p_label": string,"p_membership_id": string,"p_provider": string,"p_ref": string }; Returns: undefined
                           },
"void_gift_card":
{ Args: { "p_card_id": string,"p_reason": string }; Returns: undefined
                           },
"void_sale":
{ Args: { "p_reason": string,"p_sale_id": string }; Returns: undefined
                           }
          }
          Enums: {
            "ai_action_status": "proposed"|"approved"|"rejected"|"undone","appointment_source": "front_desk"|"phone"|"online"|"walk_in"|"import","appointment_status": "booked"|"confirmed"|"checked_in"|"completed"|"canceled"|"no_show","client_package_status": "active"|"canceled"|"refunded","deposit_kind": "none"|"fixed"|"percent","disruption_kind": "overrun"|"client_late"|"call_out","form_requirement": "none"|"first_visit"|"services","gift_card_kind": "purchased"|"promotional","gift_card_status": "active"|"voided","membership_status": "active"|"past_due"|"paused"|"canceled","notification_status": "pending"|"sent"|"canceled","online_service_mode": "bookable"|"consultation"|"off","patch_test_result": "no_reaction"|"reaction","payment_method": "cash"|"card"|"gift_card"|"package"|"membership","product_type": "retail"|"back_bar","product_unit": "g"|"ml"|"unit","purchase_order_status": "draft"|"sent"|"partly_received"|"received","resource_kind": "chair"|"room"|"station","sale_item_kind": "service"|"product"|"gift_card"|"gift_card_reload"|"package"|"membership","sale_status": "completed"|"partly_refunded"|"refunded"|"voided","staff_level": "artisan"|"senior"|"master","staff_role": "owner"|"manager"|"front_desk"|"stylist","stock_reason": "service_use"|"sale"|"count"|"order_received"|"adjustment","stocktake_status": "in_progress"|"completed"|"canceled","time_block_kind": "lunch"|"break"|"training"|"meeting"|"personal","time_off_reason": "vacation"|"sick"|"personal"|"other","time_off_status": "requested"|"approved"|"declined","waitlist_status": "waiting"|"booked"|"removed","walk_in_status": "waiting"|"booked"|"left"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "ai_action_status": ["proposed", "approved", "rejected", "undone"],"appointment_source": ["front_desk", "phone", "online", "walk_in", "import"],"appointment_status": ["booked", "confirmed", "checked_in", "completed", "canceled", "no_show"],"client_package_status": ["active", "canceled", "refunded"],"deposit_kind": ["none", "fixed", "percent"],"disruption_kind": ["overrun", "client_late", "call_out"],"form_requirement": ["none", "first_visit", "services"],"gift_card_kind": ["purchased", "promotional"],"gift_card_status": ["active", "voided"],"membership_status": ["active", "past_due", "paused", "canceled"],"notification_status": ["pending", "sent", "canceled"],"online_service_mode": ["bookable", "consultation", "off"],"patch_test_result": ["no_reaction", "reaction"],"payment_method": ["cash", "card", "gift_card", "package", "membership"],"product_type": ["retail", "back_bar"],"product_unit": ["g", "ml", "unit"],"purchase_order_status": ["draft", "sent", "partly_received", "received"],"resource_kind": ["chair", "room", "station"],"sale_item_kind": ["service", "product", "gift_card", "gift_card_reload", "package", "membership"],"sale_status": ["completed", "partly_refunded", "refunded", "voided"],"staff_level": ["artisan", "senior", "master"],"staff_role": ["owner", "manager", "front_desk", "stylist"],"stock_reason": ["service_use", "sale", "count", "order_received", "adjustment"],"stocktake_status": ["in_progress", "completed", "canceled"],"time_block_kind": ["lunch", "break", "training", "meeting", "personal"],"time_off_reason": ["vacation", "sick", "personal", "other"],"time_off_status": ["requested", "approved", "declined"],"waitlist_status": ["waiting", "booked", "removed"],"walk_in_status": ["waiting", "booked", "left"]
          }
        }
} as const
