-- MySQL dump 10.13  Distrib 8.0.44, for Win64 (x86_64)
--
-- Host: localhost    Database: ceochat
-- ------------------------------------------------------
-- Server version	8.0.44

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `admins`
--

DROP TABLE IF EXISTS `admins`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `admins` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `who` text COLLATE utf8mb4_unicode_ci,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `superuser` tinyint(1) NOT NULL DEFAULT '1' COMMENT 'Superuser has full access by default',
  `admin_access` text COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Comma-separated list of allowed functions for non-superusers',
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_admins_superuser` (`superuser`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `case_files`
--

DROP TABLE IF EXISTS `case_files`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `case_files` (
  `id` int NOT NULL AUTO_INCREMENT,
  `case_id` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_case_id` (`case_id`),
  CONSTRAINT `case_files_ibfk_1` FOREIGN KEY (`case_id`) REFERENCES `cases` (`case_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cases`
--

DROP TABLE IF EXISTS `cases`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cases` (
  `case_id` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `case_title` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `protagonist` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `protagonist_initials` varchar(3) COLLATE utf8mb4_unicode_ci NOT NULL,
  `chat_topic` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `chat_question` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `enabled` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`case_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `evaluations`
--

DROP TABLE IF EXISTS `evaluations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `evaluations` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `student_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `case_id` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `score` int NOT NULL,
  `summary` text COLLATE utf8mb4_unicode_ci,
  `criteria` json DEFAULT NULL,
  `persona` text COLLATE utf8mb4_unicode_ci,
  `hints` int DEFAULT '0',
  `helpful` float DEFAULT NULL,
  `liked` text COLLATE utf8mb4_unicode_ci,
  `improve` text COLLATE utf8mb4_unicode_ci,
  `chat_model` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `super_model` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transcript` text COLLATE utf8mb4_unicode_ci,
  `allow_rechat` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_student_id` (`student_id`),
  KEY `idx_chat_model` (`chat_model`),
  KEY `idx_super_model` (`super_model`),
  KEY `idx_case_id` (`case_id`),
  KEY `idx_student_case` (`student_id`,`case_id`),
  CONSTRAINT `evaluations_chat_model_fkey` FOREIGN KEY (`chat_model`) REFERENCES `models` (`model_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `evaluations_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `evaluations_super_model_fkey` FOREIGN KEY (`super_model`) REFERENCES `models` (`model_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `models`
--

DROP TABLE IF EXISTS `models`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `models` (
  `model_id` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `model_name` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `default_model` tinyint(1) NOT NULL DEFAULT '0',
  `input_cost` decimal(10,8) DEFAULT NULL,
  `output_cost` decimal(10,8) DEFAULT NULL,
  `temperature` decimal(3,2) DEFAULT NULL,
  `reasoning_effort` enum('low','medium','high') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`model_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `section_cases`
--

DROP TABLE IF EXISTS `section_cases`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `section_cases` (
  `id` int NOT NULL AUTO_INCREMENT,
  `section_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `case_id` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `active` tinyint(1) DEFAULT '0',
  `chat_options` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_section_case` (`section_id`,`case_id`),
  KEY `idx_section_id` (`section_id`),
  KEY `idx_case_id` (`case_id`),
  KEY `idx_active` (`section_id`,`active`),
  CONSTRAINT `section_cases_ibfk_1` FOREIGN KEY (`section_id`) REFERENCES `sections` (`section_id`) ON DELETE CASCADE,
  CONSTRAINT `section_cases_ibfk_2` FOREIGN KEY (`case_id`) REFERENCES `cases` (`case_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sections`
--

DROP TABLE IF EXISTS `sections`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sections` (
  `section_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `section_title` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `year_term` text COLLATE utf8mb4_unicode_ci,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `chat_model` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `super_model` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`section_id`),
  KEY `sections_chat_model_fkey` (`chat_model`),
  KEY `sections_super_model_fkey` (`super_model`),
  CONSTRAINT `sections_chat_model_fkey` FOREIGN KEY (`chat_model`) REFERENCES `models` (`model_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `sections_super_model_fkey` FOREIGN KEY (`super_model`) REFERENCES `models` (`model_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `sections_chk_1` CHECK ((char_length(`section_id`) <= 20))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `students`
--

DROP TABLE IF EXISTS `students`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `students` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `first_name` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_name` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `full_name` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `persona` text COLLATE utf8mb4_unicode_ci,
  `section_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `finished_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_section_id` (`section_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-12-31 14:56:44
